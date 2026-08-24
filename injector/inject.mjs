/**
 * inject.mjs — ChatGPT 桌面版照片皮肤注入器（入口）。
 *
 * 目标应用：OpenAI ChatGPT 桌面版（Windows，Electron，MSIX 包 OpenAI.Codex，
 * 主程序 app\ChatGPT.exe）。通过本地回环 CDP 注入皮肤脚本，不改官方文件。
 *
 * 用法见 README.md。零 npm 依赖，需要 Node >= 22。
 */
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'
import { connect, listTargets, isReady, pickRenderer } from './cdp.mjs'

const __dirname = typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url))
const SKIN_DIR = join(__dirname, '..', 'skin')

const APP_PROCESS_NAME = 'ChatGPT'
const APP_EXE_NAME = 'ChatGPT.exe'

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function log(message) {
  process.stdout.write(message + '\n')
}

function warn(message) {
  process.stderr.write('[警告] ' + message + '\n')
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { port: 9222, fit: 'cover', dim: 55, blur: 2 }
  const flags = new Set(['restore', 'probe', 'yes', 'help'])
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    if (!raw.startsWith('--')) continue
    const eq = raw.indexOf('=')
    const key = eq >= 0 ? raw.slice(2, eq) : raw.slice(2)
    let value = eq >= 0 ? raw.slice(eq + 1) : argv[i + 1]
    if (flags.has(key)) {
      args[key] = true
    } else {
      if (eq < 0 && value && !value.startsWith('--')) i++
      else value = undefined
      if (key === 'port') args.port = Number(value)
      else if (key === 'fit') args.fit = value
      else if (key === 'dim') args.dim = Number(value)
      else if (key === 'blur') args.blur = Number(value)
      else if (key === 'image') args.image = value
      else if (key === 'exe') args.exe = value
      else warn('未知参数 --' + key)
    }
  }
  return args
}

function usage() {
  return [
    '用法: node injector/inject.mjs [options]',
    '',
    '  不带参数: 带调试端口启动 ChatGPT 并注入皮肤运行时（右下角出现「皮肤」按钮）',
    '',
    '  --image <path>       照片路径（可选，注入后立即应用该照片）',
    '  --dim <n>            明暗：-100(最暗)~+100(最亮)，0=原图（默认 55）',
    '  --blur <n>           背景模糊 px，0-50（默认 2）',
    '  --fit cover|contain  壁纸填充（默认 cover）',
    '  --port <n>           CDP 端口（默认 9222）',
    '  --exe <path>      手动指定 ChatGPT.exe 路径',
    '  --restore         一键还原官方外观',
    '  --probe           dump ChatGPT DOM 摘要（调试）',
    '  --yes             重启 ChatGPT 前不确认',
    '  --help            显示帮助',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// ChatGPT 进程发现 / 启动
// ---------------------------------------------------------------------------

async function discoverAppExe(manual) {
  if (manual) {
    if (existsSync(manual)) return manual
    warn('--exe 指定的路径不存在: ' + manual)
  }
  // 1. 从运行中的进程取路径
  try {
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', '(Get-Process ' + APP_PROCESS_NAME + ' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)'],
      { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const path = out.trim()
    if (path && path.toLowerCase().endsWith(APP_EXE_NAME.toLowerCase())) return path
  } catch {
    /* fallthrough */
  }
  // 2. Get-AppxPackage（走 AppX 注册表，应用未运行时也可用）
  try {
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', "(Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty InstallLocation)"],
      { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const install = out.trim()
    if (install) {
      const exe = join(install, 'app', APP_EXE_NAME)
      if (existsSync(exe)) return exe
    }
  } catch {
    /* fallthrough */
  }
  return null
}

function stopApp() {
  const names = ['ChatGPT.exe', 'codex.exe', 'codex-code-mode-host.exe']
  let stopped = false
  for (const name of names) {
    try {
      execFileSync('taskkill', ['/IM', name, '/F'], { stdio: 'ignore', timeout: 15000 })
      stopped = true
    } catch {
      /* ignore */
    }
  }
  return stopped
}

function startApp(exe, port) {
  const child = spawn(exe, ['--remote-debugging-port=' + port], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  child.unref()
}

async function waitReady(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isReady(port)) return true
    await sleep(500)
  }
  return false
}

// ---------------------------------------------------------------------------
// 注入
// ---------------------------------------------------------------------------

function toDataUrl(path) {
  const buf = readFileSync(path)
  const ext = extname(path).toLowerCase()
  const mime = MIME[ext] || 'application/octet-stream'
  return 'data:' + mime + ';base64,' + buf.toString('base64')
}

/** 读取皮肤源码：SEA 打包时从内置资源读，否则从文件系统读。 */
async function readSkinSource(name) {
  if (process.isSea) {
    try {
      const sea = await import('node:sea')
      if (typeof sea.getAsset === 'function') {
        const text = sea.getAsset('skin/' + name, 'utf8')
        if (text) return text
      }
    } catch {
      /* 退回文件系统读取 */
    }
  }
  return readFileSync(join(SKIN_DIR, name), 'utf8')
}

async function buildPersistentSource() {
  const accent = await readSkinSource('accent.js')
  const apply = await readSkinSource('apply-skin.js')
  // 两个 IIFE 之间必须加分号，否则会被解析为「把 accent 的返回值当函数调用」
  return accent + '\n;' + apply + '\n'
}

/** 注入皮肤运行时（accent + apply-skin）。持久注册 + 立即执行到当前页面。 */
async function injectRuntime(client) {
  const source = await buildPersistentSource()
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  // 持久：页面重载后依然生效
  await client.send('Page.addScriptToEvaluateOnNewDocument', { source })
  // 立即执行到当前已加载页面（apply-skin.js 内部会 bootstrap：创建面板 + 恢复 localStorage）
  const result = await client.send('Runtime.evaluate', { expression: source })
  if (result.exceptionDetails) {
    throw new Error('注入失败: ' + (result.exceptionDetails.text || JSON.stringify(result.exceptionDetails)))
  }
}

/** 立即应用一张照片。 */
async function applyConfig(client, { imageDataUrl, fit, dim, blur }) {
  const config = JSON.stringify({ image: imageDataUrl, fit, dim, blur })
  const result = await client.send('Runtime.evaluate', {
    expression: 'window.CodexSkinApply ? window.CodexSkinApply.apply(' + config + ') : Promise.reject(new Error("皮肤运行时未注入"))',
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error('皮肤应用失败: ' + (result.exceptionDetails.text || JSON.stringify(result.exceptionDetails)))
  }
  return result.result
}

async function restoreSkin(client) {
  await client.send('Runtime.enable')
  await client.send('Runtime.evaluate', {
    expression: 'window.CodexSkinApply ? window.CodexSkinApply.restore() : void 0',
    returnByValue: true,
  })
}

const PROBE_EXPRESSION = `(function () {
  const q = (s) => !!document.querySelector(s)
  const cs = getComputedStyle(document.documentElement)
  const names = [
    '--color-surface',
    '--color-token-side-bar-background',
    '--color-token-main-surface-primary',
    '--color-background-primary-solid',
    '--composer-layout-surface-backdrop-filter',
  ]
  const vars = {}
  for (const n of names) vars[n] = cs.getPropertyValue(n).trim() || null
  const dark = (function () {
    const r = document.documentElement
    if (r.classList.contains('electron-dark')) return true
    if (r.classList.contains('electron-light')) return false
    const s = getComputedStyle(r).colorScheme
    return s && s !== 'normal' ? s.indexOf('dark') >= 0 : matchMedia('(prefers-color-scheme: dark)').matches
  })()
  return {
    title: document.title,
    url: location.href,
    root: q('#root'),
    sidebar: q('.app-shell-left-panel'),
    mainSurface: q('[class*="_MainContentSurface_"]'),
    composer: q('[class*="_ComposerLayoutRoot_"]'),
    submit: q('.bg-primary-solid'),
    dark: dark,
    vars: vars,
  }
})()`

async function probe(client) {
  await client.send('Runtime.enable')
  const result = await client.send('Runtime.evaluate', {
    expression: PROBE_EXPRESSION,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error('探测失败: ' + (result.exceptionDetails.text || ''))
  }
  return result.result.value
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    log(usage())
    return
  }
  if (args.image && !existsSync(args.image)) {
    warn('照片不存在: ' + args.image)
    process.exitCode = 1
    return
  }

  const exe = await discoverAppExe(args.exe)

  let ready = await isReady(args.port)
  if (!ready) {
    if (exe === null) {
      warn('未找到 ChatGPT.exe（请用 --exe 手动指定，或先启动 ChatGPT 桌面版）')
      process.exitCode = 1
      return
    }
    log('ChatGPT 未开启调试端口，将带 --remote-debugging-port=' + args.port + ' 重启 ChatGPT。')
    if (!args.yes) {
      log('这会关闭当前正在运行的 ChatGPT 窗口（未保存内容可能丢失）。')
      log('确认重启？(y/N)')
      const answer = await new Promise((resolve) => {
        process.stdin.once('data', (d) => resolve(d.toString().trim().toLowerCase()))
        process.stdin.resume()
      })
      if (answer !== 'y' && answer !== 'yes') {
        log('已取消。')
        return
      }
    }
    log('关闭现有 ChatGPT...')
    stopApp()
    await sleep(1500)
    log('以调试端口启动 ChatGPT: ' + exe)
    startApp(exe, args.port)
    log('等待调试端口就绪...')
    ready = await waitReady(args.port, 40000)
    if (!ready) {
      warn('调试端口未在 40 秒内就绪，请手动确认 ChatGPT 是否已启动。')
      process.exitCode = 1
      return
    }
  }

  let target = pickRenderer(await listTargets(args.port))
  if (target === null) {
    // renderer page target 可能仍在加载，轮询等待
    log('等待 ChatGPT 主窗口 renderer 出现...')
    const deadline = Date.now() + 30000
    while (target === null && Date.now() < deadline) {
      await sleep(500)
      target = pickRenderer(await listTargets(args.port))
    }
  }
  if (target === null) {
    warn('未找到 ChatGPT renderer target（30 秒超时）。')
    process.exitCode = 1
    return
  }

  const client = await connect(target.webSocketDebuggerUrl)
  try {
    if (args.restore) {
      await restoreSkin(client)
      log('已还原官方外观。')
      return
    }

    if (args.probe) {
      const summary = await probe(client)
      log(JSON.stringify(summary, null, 2))
      return
    }

    await injectRuntime(client)
    if (args.image) {
      log('读取照片并应用（fit=' + args.fit + ', dim=' + args.dim + ', blur=' + args.blur + '）...')
      const palette = await applyConfig(client, {
        imageDataUrl: toDataUrl(args.image),
        fit: args.fit,
        dim: args.dim,
        blur: args.blur,
      })
      const accent = palette && palette.value && palette.value.accent ? palette.value.accent : '(已应用)'
      log('注入完成。取色 accent = ' + accent)
    } else {
      log('已注入皮肤运行时：ChatGPT 右下角出现「皮肤」按钮。')
      log('（若之前保存过皮肤会自动恢复；否则点按钮在面板里选择照片。）')
    }
  } finally {
    client.close()
  }
}

main().catch((error) => {
  process.stderr.write('[错误] ' + (error && error.message ? error.message : String(error)) + '\n')
  process.exitCode = 1
})
