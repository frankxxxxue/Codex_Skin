/**
 * accent.js — 取色算法，移植自 dsh-photo-skins 的 src/client/accent.ts（纯函数）。
 * 在 Node（module.exports）与浏览器（globalThis.CodexSkinAccent）中均可使用。
 */
(function (global) {
  'use strict'

  function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(value)))
  }

  function hex2(value) {
    return clampByte(value).toString(16).padStart(2, '0')
  }

  /** `#rrggbb` from an RGB color. */
  function rgbToHex(rgb) {
    return '#' + hex2(rgb.r) + hex2(rgb.g) + hex2(rgb.b)
  }

  /** `#rrggbb` (or shorthand `#rgb`) to an RGB color. Assumes a valid hex string. */
  function hexToRgb(hex) {
    const clean = hex.replace('#', '')
    if (clean.length === 3) {
      return {
        r: parseInt(clean[0] + clean[0], 16),
        g: parseInt(clean[1] + clean[1], 16),
        b: parseInt(clean[2] + clean[2], 16),
      }
    }
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    }
  }

  /** Relative luminance (0-1), Rec. 601 weights. */
  function luminance(rgb) {
    return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255
  }

  /** Mix two RGB colors (t 0-1: 0 = a, 1 = b). */
  function mix(a, b, t) {
    const clamped = Math.max(0, Math.min(1, t))
    return {
      r: a.r + (b.r - a.r) * clamped,
      g: a.g + (b.g - a.g) * clamped,
      b: a.b + (b.b - a.b) * clamped,
    }
  }

  /** The dominant RGB color from a pixel sample (bucket histogram + average). */
  function dominantColor(pixels) {
    const { data, width, height } = pixels
    const buckets = new Map()
    const step = Math.max(1, Math.floor((width * height) / 4096))
    for (let i = 0; i < data.length; i += 4 * step) {
      const alpha = data[i + 3] ?? 255
      if (alpha < 128) continue // skip transparent pixels
      const r = data[i] ?? 0
      const g = data[i + 1] ?? 0
      const b = data[i + 2] ?? 0
      // 4-bit buckets: nearby shades merge before the count comparison.
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
      const bucket = buckets.get(key)
      if (bucket === undefined) {
        buckets.set(key, { count: 1, r, g, b })
      } else {
        bucket.count += 1
        bucket.r += r
        bucket.g += g
        bucket.b += b
      }
    }
    let best = null
    for (const bucket of buckets.values()) {
      if (best === null || bucket.count > best.count) best = bucket
    }
    if (best === null) return { r: 24, g: 24, b: 32 }
    return { r: best.r / best.count, g: best.g / best.count, b: best.b / best.count }
  }

  /** Average RGB over the sample. */
  function averageColor(pixels) {
    const { data, width, height } = pixels
    const step = Math.max(1, Math.floor((width * height) / 4096))
    let count = 0
    let r = 0
    let g = 0
    let b = 0
    for (let i = 0; i < data.length; i += 4 * step) {
      if ((data[i + 3] ?? 255) < 128) continue
      r += data[i] ?? 0
      g += data[i + 1] ?? 0
      b += data[i + 2] ?? 0
      count += 1
    }
    if (count === 0) return { r: 24, g: 24, b: 32 }
    return { r: r / count, g: g / count, b: b / count }
  }

  /** Readable text color on a given background: white on dark, near-black on light. */
  function contrastTextFor(rgb) {
    return luminance(rgb) > 0.5 ? '#101828' : '#ffffff'
  }

  /**
   * Derive the full accent palette from a pixel sample. The accent is the
   * dominant color nudged toward the sample average (a third of the way).
   */
  function samplePalette(pixels) {
    const dominant = dominantColor(pixels)
    const average = averageColor(pixels)
    const accent = mix(dominant, average, 1 / 3)
    const scrimDark = mix(accent, { r: 0, g: 0, b: 0 }, 0.82)
    const scrimLight = mix(accent, { r: 255, g: 255, b: 255 }, 0.9)
    return {
      accent: rgbToHex(accent),
      accentSoft: 'rgba(' + Math.round(accent.r) + ', ' + Math.round(accent.g) + ', ' + Math.round(accent.b) + ', 0.18)',
      accentContrast: contrastTextFor(accent),
      scrimDark: 'rgba(' + Math.round(scrimDark.r) + ', ' + Math.round(scrimDark.g) + ', ' + Math.round(scrimDark.b) + ', 0.34)',
      scrimLight: 'rgba(' + Math.round(scrimLight.r) + ', ' + Math.round(scrimLight.g) + ', ' + Math.round(scrimLight.b) + ', 0.10)',
    }
  }

  const api = {
    rgbToHex,
    hexToRgb,
    luminance,
    mix,
    dominantColor,
    averageColor,
    contrastTextFor,
    samplePalette,
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  } else {
    global.CodexSkinAccent = api
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
