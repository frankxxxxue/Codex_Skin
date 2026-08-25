/**
 * build-exe.mjs — 把注入器打包成单个可执行文件（Windows: CodexSkin.exe / macOS: CodexSkin）。
 * 用 Node 内置的 SEA（Single Executable Application），无需用户安装 Node。
 * 运行：node build-exe.mjs（首次会用 npx 拉取 postject，需要网络）。
 *
 * 注意：SEA 复制的是当前平台的 node 二进制，产物不可跨平台交叉编译——
 * macOS 的 CodexSkin 必须在 macOS 上构建，Windows 的 CodexSkin.exe 必须在 Windows 上构建。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, copyFileSync, existsSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const IS_MAC = process.platform === 'darwin'

const root = dirname(fileURLToPath(import.meta.url))
const dist = join(root, 'dist')
mkdirSync(dist, { recursive: true })

const blob = join(dist, 'sea-prep.blob')
const exe = join(dist, IS_MAC ? 'CodexSkin' : 'CodexSkin.exe')
const cjs = join(dist, 'inject.cjs')

console.log('esbuild 打包 ESM -> CJS...')
execFileSync(
  'npx esbuild injector/inject.mjs --bundle --platform=node --format=cjs --outfile=' + cjs,
  { stdio: 'inherit', cwd: root, shell: true },
)

console.log('生成 SEA blob...')
execFileSync(process.execPath, ['--experimental-sea-config', 'sea-config.json'], { stdio: 'inherit', cwd: root })
if (!existsSync(blob)) throw new Error('未生成 ' + blob)

console.log('复制 node 二进制为 ' + exe + '...')
copyFileSync(process.execPath, exe)

if (IS_MAC) {
  // 官方 node 若是 universal binary（x86_64 + arm64 双切片），NODE_SEA_FUSE sentinel
  // 会在两个切片各出现一次，postject 报 "Multiple occurrences"。但 lipo 瘦身后重新打包
  // 的 Mach-O 又可能让 postject 注入偏移出错（产物段错误）。最稳的是用「天然单架构」的
  // node（arch-specific tar.gz）构建、完全跳过 lipo；只有检测到 universal 才瘦身兜底。
  let isUniversal = false
  try {
    const info = execFileSync('lipo', ['-info', exe], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    isUniversal = /universal/i.test(info)
  } catch {
    /* lipo 不可用或非 fat 文件，视为单架构 */
  }
  if (isUniversal) {
    const lipoArch = process.arch === 'x64' ? 'x86_64' : process.arch
    console.log('node 是 universal binary，瘦身为单架构（lipo -thin ' + lipoArch + '）...')
    const thin = exe + '.thin'
    execFileSync('lipo', ['-thin', lipoArch, exe, '-output', thin], { stdio: 'inherit' })
    copyFileSync(thin, exe)
    unlinkSync(thin)
  } else {
    // 单架构 node 同样带 Apple 签名，postject 前必须先移除，否则注入破坏 Mach-O（产物段错误）
    console.log('node 已是单架构，移除原签名（codesign --remove-signature）...')
    execFileSync('codesign', ['--remove-signature', exe], { stdio: 'inherit' })
  }
}

console.log('注入 blob（npx postject）...')
const fuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
execFileSync(
  'npx --yes postject "' + exe + '" NODE_SEA_BLOB "' + blob + '" --sentinel-fuse ' + fuse,
  { stdio: 'inherit', cwd: root, shell: true },
)

if (IS_MAC) {
  console.log('ad-hoc 重签（codesign -s -）...')
  execFileSync('codesign', ['-s', '-', exe], { stdio: 'inherit' })
}

console.log('打包完成: ' + exe)
