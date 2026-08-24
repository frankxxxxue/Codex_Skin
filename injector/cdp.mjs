/**
 * cdp.mjs — 最小 Chrome DevTools Protocol 客户端（零依赖）。
 * 依赖 Node 22 原生 WebSocket / fetch。
 */

/** 连接到 CDP WebSocket 并返回一个最小客户端。 */
export async function connect(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', (event) => reject(new Error('CDP WebSocket 连接失败: ' + String(event.message || ''))), { once: true })
  })

  let nextId = 1
  const pending = new Map()
  const listeners = new Set()

  ws.addEventListener('message', (event) => {
    let message
    try {
      message = JSON.parse(event.data)
    } catch {
      return
    }
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)))
      else resolve(message.result)
    } else if (message.method) {
      for (const listener of listeners) listener(message.method, message.params)
    }
  })

  function send(method, params = {}) {
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  }

  function on(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function close() {
    try { ws.close() } catch { /* ignore */ }
  }

  return { send, on, close }
}

/** 列出某调试端口的全部 target。 */
export async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json`)
  if (!response.ok) throw new Error(`CDP /json 返回 ${response.status}`)
  return response.json()
}

/** 探测调试端口是否就绪。 */
export async function isReady(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`)
    return response.ok
  } catch {
    return false
  }
}

/** 从 target 列表里挑选主 renderer（page 类型，通常是 Codex 主窗口）。 */
export function pickRenderer(targets) {
  const pages = (targets || []).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  // 优先选主窗口（app://-/index.html 无 query 参数）；否则取第一个 page。
  // 启动时可能同时存在 avatar-overlay 等覆盖页（带 ?initialRoute= 参数），需跳过。
  const main = pages.find((t) => t.url === 'app://-/index.html')
  return main || pages[0] || null
}
