/**
 * apply-skin.js — 注入到 ChatGPT 桌面版 renderer 的照片皮肤脚本（自包含，无依赖）。
 * 依赖 window.CodexSkinAccent（由 accent.js 提供）。
 *
 * 这是「图片替换（照片融合背景）」版：
 *   - 照片铺在独立的 fixed z-index:-1 图层（[data-codex-photo-layer]），把原生
 *     不透明表面令牌（--color-surface、--color-token-side-bar-background 等）
 *     覆写为 transparent，消除白色方块；
 *   - 侧边栏 / 内容区 / 标题栏完全透明，border 也透明，照片贯穿、无发白分隔线；
 *   - 输入框 / 弹窗用半透明 + backdrop-filter 磨砂（小面积，安全）保证可读；
 *   - 文字可读性靠主题底色 text-shadow 光晕；
 *   - 跟随照片取色：主按钮 / 聚焦 / 链接。
 *
 * 融合手法参考社区 Codex-Dream-Skin / codex-theme-inject：底层铺图 + 半透明渐变
 * 遮罩覆面 + CSS 变量覆写，不用 backdrop-filter 压整图。
 */
(function () {
  'use strict'

  const STYLE_ID = 'codex-photo-skins-style'
  const ROOT_ATTR = 'data-codex-photo-skins'
  const PANEL_STYLE_ID = 'codex-skin-panel-style'
  const PANEL_ID = 'codex-skin-panel'
  const TOGGLE_ID = 'codex-skin-toggle'
  const LS_KEY = 'codex-skin-config'

  let lastConfig = null
  let cachedPalette = null
  let persistedImage = null
  let themeObserver = null
  let photoElement = null

  function isDark() {
    const root = document.documentElement
    if (root.classList.contains('electron-dark')) return true
    if (root.classList.contains('electron-light')) return false
    const scheme = getComputedStyle(root).colorScheme
    if (scheme && scheme !== 'normal') return scheme.indexOf('dark') >= 0
    return matchMedia('(prefers-color-scheme: dark)').matches
  }

  function rgba(rgb, alpha) {
    return 'rgba(' + Math.round(rgb.r) + ', ' + Math.round(rgb.g) + ', ' + Math.round(rgb.b) + ', ' + alpha + ')'
  }

  function loadPixels(imageUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const edge = 64
          const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight))
          const w = Math.max(1, Math.round(img.naturalWidth * scale))
          const h = Math.max(1, Math.round(img.naturalHeight * scale))
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          ctx.drawImage(img, 0, 0, w, h)
          const data = ctx.getImageData(0, 0, w, h)
          resolve({ data: data.data, width: w, height: h })
        } catch (error) {
          reject(error)
        }
      }
      img.onerror = () => reject(new Error('无法加载照片'))
      img.src = imageUrl
    })
  }

  function compressImage(dataUrl, maxEdge) {
    return new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
          const w = Math.max(1, Math.round(img.naturalWidth * scale))
          const h = Math.max(1, Math.round(img.naturalHeight * scale))
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          canvas.getContext('2d').drawImage(img, 0, 0, w, h)
          resolve(canvas.toDataURL('image/jpeg', 0.85))
        } catch {
          resolve(dataUrl)
        }
      }
      img.onerror = () => resolve(dataUrl)
      img.src = dataUrl
    })
  }

  function normalize(config) {
    return {
      image: config.image,
      fit: config.fit === 'contain' ? 'contain' : 'cover',
      dim: clamp(config.dim == null ? 55 : Number(config.dim), -100, 100),
      blur: clamp(config.blur == null ? 2 : Number(config.blur), 0, 50),
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
  }

  // -------------------------------------------------------------------------
  // CSS 生成（融合版）
  // -------------------------------------------------------------------------

  function buildCss(config, palette, dark) {
    const accent = window.CodexSkinAccent
    const neutral = dark ? { r: 18, g: 20, b: 24 } : { r: 250, g: 250, b: 252 }
    const base = accent.mix(neutral, accent.hexToRgb(palette.accent), dark ? 0.05 : 0.04)

    // 输入框（composer）：半透明，保证输入区可读
    const bannerBg = rgba(base, dark ? 0.85 : 0.85)
    // 弹窗（elevated）：半透明，保证可读
    const elevatedBg = rgba(base, dark ? 0.90 : 0.92)
    // text-shadow 光晕色：主题底色（浅色主题白晕、深色主题黑晕），保文字可读而不大面积发白
    const shadowNear = rgba(neutral, dark ? 0.50 : 0.60)
    const shadowFar = rgba(neutral, dark ? 0.28 : 0.32)

    return [
      ':root {',
      '  --cs-accent: ' + palette.accent + ';',
      '  --cs-accent-soft: ' + palette.accentSoft + ';',
      '  --cs-accent-contrast: ' + palette.accentContrast + ';',
      // 跟随取色的强调（主按钮 / 链接 / 聚焦）
      '  --color-background-primary-solid: ' + palette.accent + ' !important;',
      '  --color-background-accent: ' + palette.accent + ' !important;',
      '  --color-background-accent-hover: ' + palette.accent + ' !important;',
      '  --color-text-accent: ' + palette.accent + ' !important;',
      '  --color-text-on-accent: ' + palette.accentContrast + ' !important;',
      '  --color-text-button-primary: ' + palette.accentContrast + ' !important;',
      '  --color-icon-accent: ' + palette.accent + ' !important;',
      '  --icon-accent: ' + palette.accent + ' !important;',
      '  --color-border-focus: ' + palette.accent + ' !important;',
      '  --color-ring: ' + palette.accent + ' !important;',
      // 原生不透明表面令牌 → 透明（消除白色方块，让照片贯穿）
      '  --color-surface: transparent !important;',
      '  --color-surface-secondary: transparent !important;',
      '  --color-surface-tertiary: transparent !important;',
      '  --color-token-main-surface-primary: transparent !important;',
      '  --color-token-side-bar-background: transparent !important;',
      '  --color-token-bg-primary: transparent !important;',
      '  --color-token-bg-secondary: transparent !important;',
      '  --color-token-bg-tertiary: transparent !important;',
      '  --color-background-surface: transparent !important;',
      '  --color-background-surface-under: transparent !important;',
      '  --bg-primary: transparent !important;',
      '  --bg-secondary: transparent !important;',
      '  --bg-tertiary: transparent !important;',
      // 弹窗（elevated）保持半透明可读
      '  --color-surface-elevated: ' + elevatedBg + ' !important;',
      '  --color-surface-elevated-secondary: ' + elevatedBg + ' !important;',
      '  --color-background-elevated-primary: ' + elevatedBg + ' !important;',
      '  --color-background-elevated-secondary: ' + elevatedBg + ' !important;',
      '  --bg-elevated-primary: ' + elevatedBg + ' !important;',
      '  --bg-elevated-secondary: ' + elevatedBg + ' !important;',
      // 输入框（composer）：半透明 + 磨砂
      '  --composer-layout-surface-background: ' + bannerBg + ' !important;',
      '  --composer-layout-surface-backdrop-filter: blur(16px) saturate(1.4) !important;',
      '}',
      // 壁纸照片由 photoElement（z-index:-1）承载；body 透明，透出 html 中性色
      'html { background-color: ' + rgba(neutral, 1) + ' !important; }',
      'body { background: transparent !important; }',
      '#root { background: transparent !important; }',
      // 最外层 main.bg-surface 透明
      'main.bg-surface { background: transparent !important; }',
      // 侧边栏 / 内容区 / 标题栏：完全透明，照片原色直接透出（无白色遮罩，不发白）
      '.app-shell-left-panel { background: transparent !important; }',
      '[class*="_MainContentSurface_"] { background: transparent !important; }',
      'header { background: transparent !important; }',
      // 主要元素边界透明：照片从侧边栏到内容区连续覆盖，无发白分隔线
      '.app-shell-left-panel, [class*="_MainContentSurface_"], header { border-color: transparent !important; }',
      // 文字可读性：主题底色光晕（轻，不遮照片）
      '[data-turn-key], [class*="_markdown"] {',
      '  text-shadow: 0 1px 2px ' + shadowNear + ', 0 0 8px ' + shadowFar + ' !important;',
      '}',
      '.app-shell-left-panel { text-shadow: 0 1px 2px ' + shadowNear + ' !important; }',
      // 弹窗/菜单磨砂
      '[role="dialog"], [role="menu"], [role="listbox"] {',
      '  -webkit-backdrop-filter: blur(16px) !important;',
      '  backdrop-filter: blur(16px) !important;',
      '}',
      // 强调应用
      '.bg-primary-solid { color: ' + palette.accentContrast + ' !important; }',
      '::selection { background: var(--cs-accent-soft); }',
      'a { color: var(--cs-accent); }',
    ].join('\n')
  }

  function applyStyle(css) {
    let style = document.getElementById(STYLE_ID)
    if (style === null) {
      style = document.createElement('style')
      style.id = STYLE_ID
      document.head.appendChild(style)
    }
    style.textContent = css
    document.documentElement.setAttribute(ROOT_ATTR, '')
  }

  // -------------------------------------------------------------------------
  // 照片层（fixed z-index:-1 的 div，铺照片 + dim 遮罩，用 filter:blur 模糊照片本身）
  // 说明：照片放在独立图层而非 body 背景，filter:blur 直接作用照片元素，
  // 一定生效（backdrop-filter 在 Electron 外壳上对 body 背景无效）。
  // -------------------------------------------------------------------------

  function syncPhotoLayer() {
    const image = lastConfig ? lastConfig.image : null
    if (!image) {
      if (photoElement !== null) {
        photoElement.remove()
        photoElement = null
      }
      return
    }

    if (photoElement === null) {
      photoElement = document.querySelector('[data-codex-photo-layer]')
      if (photoElement === null) {
        const element = document.createElement('div')
        element.style.position = 'fixed'
        element.style.inset = '-60px'
        element.style.zIndex = '-1'
        element.style.pointerEvents = 'none'
        element.setAttribute('aria-hidden', 'true')
        element.setAttribute('data-codex-photo-layer', '')
        photoElement = element
        document.body.appendChild(photoElement)
      }
    }

    const fit = lastConfig.fit
    const dim = lastConfig.dim
    const dimColor = dim <= 0
      ? 'rgba(0, 0, 0, ' + (-dim / 100) + ')'
      : 'rgba(255, 255, 255, ' + (dim / 100) + ')'
    const dimLayer = 'linear-gradient(' + dimColor + ', ' + dimColor + ')'

    photoElement.style.backgroundImage = dimLayer + ', url("' + image + '")'
    photoElement.style.backgroundSize = '100% 100%, ' + fit
    photoElement.style.backgroundPosition = 'center, center'
    photoElement.style.backgroundRepeat = 'no-repeat, no-repeat'
    photoElement.style.filter = lastConfig.blur > 0 ? 'blur(' + lastConfig.blur + 'px)' : 'none'
  }

  function ensureThemeObserver() {
    if (themeObserver !== null) return
    themeObserver = new MutationObserver(() => {
      if (lastConfig) applyStyle(buildCss(lastConfig, cachedPalette, isDark()))
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'data-mode'],
    })
  }

  // -------------------------------------------------------------------------
  // 持久化
  // -------------------------------------------------------------------------

  function readSaved() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY)) || null
    } catch {
      return null
    }
  }

  function persistParams() {
    if (!lastConfig) return
    const image = persistedImage || lastConfig.image
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        image,
        fit: lastConfig.fit,
        dim: lastConfig.dim,
        blur: lastConfig.blur,
      }))
    } catch {
      /* quota 超限时忽略 */
    }
  }

  // -------------------------------------------------------------------------
  // 应用 / 更新 / 恢复
  // -------------------------------------------------------------------------

  function apply(config) {
    lastConfig = normalize(config)
    const dark = isDark()
    return loadPixels(lastConfig.image).then((pixels) => {
      cachedPalette = window.CodexSkinAccent.samplePalette(pixels)
      applyStyle(buildCss(lastConfig, cachedPalette, dark))
      syncPhotoLayer()
      ensureThemeObserver()
      syncPanel(lastConfig)
      // 立即持久化（用原图，避免页面导航导致 localStorage 未写入、皮肤失效）；
      // 压缩图异步写入，替换掉原图以省空间。
      persistParams()
      compressImage(lastConfig.image, 1920).then((img) => {
        if (lastConfig) {
          persistedImage = img
          persistParams()
        }
      })
      return cachedPalette
    })
  }

  function updateParams(patch) {
    if (!lastConfig) return
    lastConfig = normalize(Object.assign({}, lastConfig, patch))
    applyStyle(buildCss(lastConfig, cachedPalette, isDark()))
    syncPhotoLayer()
    syncPanel(lastConfig)
    persistParams()
  }

  function restore() {
    lastConfig = null
    cachedPalette = null
    persistedImage = null
    const style = document.getElementById(STYLE_ID)
    if (style !== null) style.remove()
    document.querySelectorAll('[data-codex-photo-layer]').forEach((el) => el.remove())
    photoElement = null
    document.documentElement.removeAttribute(ROOT_ATTR)
    if (themeObserver !== null) {
      themeObserver.disconnect()
      themeObserver = null
    }
    try {
      localStorage.removeItem(LS_KEY)
    } catch {
      /* ignore */
    }
    // 保留「皮肤」按钮，仅重置面板显示（修复：恢复后按钮消失）
    syncPanel(null)
  }

  // -------------------------------------------------------------------------
  // 面板 UI（简化：选择照片 / 恢复 / 填充 / 取色）
  // -------------------------------------------------------------------------

  const PANEL_CSS = [
    '#' + TOGGLE_ID + ' {',
    '  position: fixed; right: 18px; bottom: 18px; z-index: 2147483000;',
    '  background: rgba(20,22,28,0.85); color: #f2f4f8;',
    '  border: 1px solid rgba(255,255,255,0.18); border-radius: 999px;',
    '  padding: 9px 16px; font: 13px/1 system-ui, sans-serif; cursor: pointer;',
    '  box-shadow: 0 6px 24px rgba(0,0,0,0.35);',
    '}',
    '#' + TOGGLE_ID + ':hover { background: rgba(30,33,42,0.95); }',
    '#' + PANEL_ID + ' {',
    '  position: fixed; right: 18px; bottom: 72px; z-index: 2147483000;',
    '  width: 240px; box-sizing: border-box;',
    '  display: none; flex-direction: column; gap: 10px;',
    '  background: rgba(20,22,28,0.94); color: #e8ebf1;',
    '  border: 1px solid rgba(255,255,255,0.16); border-radius: 14px;',
    '  padding: 14px; font: 13px/1.5 system-ui, sans-serif;',
    '  box-shadow: 0 12px 40px rgba(0,0,0,0.45);',
    '}',
    '#' + PANEL_ID + '.open { display: flex; }',
    '#' + PANEL_ID + ' .cs-head { display: flex; justify-content: space-between; align-items: center; }',
    '#' + PANEL_ID + ' .cs-title { font-weight: 600; font-size: 14px; }',
    '#' + PANEL_ID + ' .cs-close { background: none; border: none; color: #aab; cursor: pointer; font-size: 18px; line-height: 1; }',
    '#' + PANEL_ID + ' .cs-row { display: flex; gap: 8px; align-items: center; }',
    '#' + PANEL_ID + ' button.cs-btn { flex: 1; background: rgba(255,255,255,0.10); color: #f2f4f8; border: 1px solid rgba(255,255,255,0.16); border-radius: 8px; padding: 8px 10px; cursor: pointer; font: inherit; }',
    '#' + PANEL_ID + ' button.cs-btn:hover { background: rgba(255,255,255,0.18); }',
    '#' + PANEL_ID + ' .cs-accent { width: 20px; height: 20px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.3); flex: none; }',
    '#' + PANEL_ID + ' .cs-field { display: flex; flex-direction: column; gap: 4px; }',
    '#' + PANEL_ID + ' .cs-field .cs-label { display: flex; justify-content: space-between; color: #b9c0cd; font-size: 12px; }',
    '#' + PANEL_ID + ' input[type=range] { width: 100%; accent-color: #6f8bff; }',
    '#' + PANEL_ID + ' .cs-hint { color: #9aa2b1; font-size: 12px; }',
  ].join('\n')

  function removePanel() {
    const ids = [TOGGLE_ID, PANEL_ID, PANEL_STYLE_ID]
    for (const id of ids) {
      const el = document.getElementById(id)
      if (el) el.remove()
    }
  }

  function ensurePanel() {
    const existing = document.getElementById(PANEL_ID)
    if (existing !== null) {
      if (existing.querySelector('[data-cs="dim"]') !== null) return
      removePanel()
    }

    let style = document.getElementById(PANEL_STYLE_ID)
    if (style === null) {
      style = document.createElement('style')
      style.id = PANEL_STYLE_ID
      style.textContent = PANEL_CSS
      document.head.appendChild(style)
    }

    const host = document.createElement('div')
    host.innerHTML = [
      '<button id="' + TOGGLE_ID + '" type="button">皮肤</button>',
      '<div id="' + PANEL_ID + '">',
      '  <div class="cs-head"><span class="cs-title">照片皮肤</span><button class="cs-close" type="button" data-cs="close">&times;</button></div>',
      '  <div class="cs-row">',
      '    <button class="cs-btn" type="button" data-cs="pick">选择照片</button>',
      '    <button class="cs-btn" type="button" data-cs="restore">恢复官方</button>',
      '  </div>',
      '  <div class="cs-field">',
      '    <span class="cs-label"><span>明暗（-暗 / +亮）</span><span data-cs="dim-v">55</span></span>',
      '    <input type="range" min="-100" max="100" step="1" value="55" data-cs="dim">',
      '  </div>',
      '  <div class="cs-field">',
      '    <span class="cs-label"><span>背景模糊</span><span data-cs="blur-v">2</span></span>',
      '    <input type="range" min="0" max="50" step="1" value="2" data-cs="blur">',
      '  </div>',
      '  <div class="cs-row">',
      '    <button class="cs-btn" type="button" data-cs="fit">填充: cover</button>',
      '    <span class="cs-accent" data-cs="accent"></span>',
      '  </div>',
      '  <div class="cs-hint">照片铺满背景，侧边栏/标题栏做半透明融合，主色跟随照片。</div>',
      '  <input type="file" accept="image/*" data-cs="file" hidden>',
      '</div>',
    ].join('')
    document.body.appendChild(host)

    const toggle = document.getElementById(TOGGLE_ID)
    const panel = document.getElementById(PANEL_ID)
    const $ = (name) => panel.querySelector('[data-cs="' + name + '"]')

    toggle.addEventListener('click', () => panel.classList.toggle('open'))
    $('close').addEventListener('click', () => panel.classList.remove('open'))

    $('pick').addEventListener('click', () => $('file').click())
    $('file').addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const base = lastConfig || { fit: 'cover', dim: 55, blur: 2 }
        apply(Object.assign({}, base, { image: String(reader.result) }))
      }
      reader.readAsDataURL(file)
      event.target.value = ''
    })

    $('restore').addEventListener('click', restore)

    const fitButton = $('fit')
    fitButton.addEventListener('click', () => {
      const next = (lastConfig && lastConfig.fit === 'cover') ? 'contain' : 'cover'
      updateParams({ fit: next })
    })

    const bindRange = (name, key, display) => {
      const input = $(name)
      const label = $(display)
      input.addEventListener('input', () => {
        const value = Number(input.value)
        label.textContent = String(value)
        updateParams({ [key]: value })
      })
    }
    bindRange('dim', 'dim', 'dim-v')
    bindRange('blur', 'blur', 'blur-v')
  }

  function syncPanel(config) {
    const panel = document.getElementById(PANEL_ID)
    if (panel === null) return
    const $ = (name) => panel.querySelector('[data-cs="' + name + '"]')
    if (config === null) {
      $('fit').textContent = '填充: cover'
      $('dim').value = '55'
      $('dim-v').textContent = '55'
      $('blur').value = '2'
      $('blur-v').textContent = '2'
      $('accent').style.background = 'transparent'
      return
    }
    $('fit').textContent = '填充: ' + config.fit
    const dim = String(config.dim)
    const blur = String(config.blur)
    $('dim').value = dim
    $('dim-v').textContent = dim
    $('blur').value = blur
    $('blur-v').textContent = blur
    if (cachedPalette) $('accent').style.background = cachedPalette.accent
  }

  // -------------------------------------------------------------------------
  // 启动
  // -------------------------------------------------------------------------

  function bootstrap() {
    ensurePanel()
    const saved = readSaved()
    if (saved && saved.image) {
      persistedImage = saved.image
      apply(saved)
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap)
  } else {
    bootstrap()
  }

  window.CodexSkinApply = { apply, restore }
})()
