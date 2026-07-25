// theme.ts — the skin/theme engine.
//
// A theme is five anchor colors (background, surface, text, border, accent) plus
// a base (dark | light). The full neutral token set is DERIVED from the anchors
// using the browser's own `color-mix(in oklch, …)` engine — no colour-math
// library. Semantic tokens (status dots, syntax highlight, shadows) stay defined
// per-base in theme.css and are selected by `data-theme`, so a skin only recolours
// the chrome, never the meaning of a status. Built-in skins and user themes share
// this model, so any preset can be duplicated and tweaked.

export type ThemeBase = 'dark' | 'light'

export interface ThemeAnchors {
  bg: string       // app background
  surface: string  // panels / cards / inputs
  text: string     // primary text
  border: string   // hairlines
  accent: string   // brand / selection colour
}

export interface Theme {
  id: string
  name: string
  base: ThemeBase
  builtin?: boolean
  anchors: ThemeAnchors
}

export const ANCHOR_LABELS: { key: keyof ThemeAnchors; label: string }[] = [
  { key: 'bg', label: 'Background' },
  { key: 'surface', label: 'Surface' },
  { key: 'text', label: 'Text' },
  { key: 'border', label: 'Border' },
  { key: 'accent', label: 'Accent' },
]

// The neutral tokens a theme overrides (everything else inherits from the base).
const TOKEN_ORDER = [
  '--bg', '--bg-2', '--bg-3', '--sidebar', '--editor-bg', '--titlebar',
  '--text', '--text-2', '--text-3', '--dim',
  '--border', '--border-2',
  '--accent', '--accent-fg', '--accent-soft', '--sel-bg', '--sel-bar',
] as const

// Per-token color-mix recipe over the anchor vars. Functions branch on base where
// the direction differs (e.g. a "raised" surface lightens in dark, darkens in light).
function recipes(base: ThemeBase): Record<string, string> {
  const dark = base === 'dark'
  return {
    '--bg': 'var(--k-bg)',
    '--bg-2': 'var(--k-surface)',
    '--bg-3': 'color-mix(in oklch, var(--k-surface), var(--k-text) 7%)',
    '--sidebar': dark ? 'color-mix(in oklch, var(--k-bg), #000 10%)' : 'color-mix(in oklch, var(--k-bg), #000 3%)',
    '--titlebar': dark ? 'color-mix(in oklch, var(--k-bg), #000 10%)' : 'color-mix(in oklch, var(--k-bg), #000 3%)',
    '--editor-bg': dark ? 'color-mix(in oklch, var(--k-bg), #fff 7%)' : 'color-mix(in oklch, var(--k-bg), #fff 55%)',
    '--text': 'var(--k-text)',
    '--text-2': 'color-mix(in oklch, var(--k-text), var(--k-bg) 38%)',
    '--text-3': 'color-mix(in oklch, var(--k-text), var(--k-bg) 60%)',
    '--dim': 'color-mix(in oklch, var(--k-text), var(--k-bg) 76%)',
    '--border': 'var(--k-border)',
    '--border-2': 'color-mix(in oklch, var(--k-border), var(--k-text) 22%)',
    '--accent': 'var(--k-accent)',
    '--accent-fg': dark ? 'oklch(0.99 0 0)' : 'oklch(0.99 0 0)',
    '--accent-soft': 'color-mix(in oklch, var(--k-accent) 20%, transparent)',
    '--sel-bg': dark ? 'color-mix(in oklch, var(--k-accent) 26%, var(--k-surface))' : 'color-mix(in oklch, var(--k-accent) 16%, var(--k-surface))',
    '--sel-bar': 'var(--k-accent)',
  }
}

/**
 * Resolve the anchor recipes to concrete colour strings using the browser engine.
 * Returns an ordered token→value map ready to set as inline vars.
 */
export function deriveTokens(anchors: ThemeAnchors, base: ThemeBase): Record<string, string> {
  if (typeof document === 'undefined' || !document.body) return {}
  const el = document.createElement('div')
  el.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;'
  el.style.setProperty('--k-bg', anchors.bg)
  el.style.setProperty('--k-surface', anchors.surface)
  el.style.setProperty('--k-text', anchors.text)
  el.style.setProperty('--k-border', anchors.border)
  el.style.setProperty('--k-accent', anchors.accent)
  document.body.appendChild(el)
  const recipe = recipes(base)
  const out: Record<string, string> = {}
  for (const token of TOKEN_ORDER) {
    el.style.color = recipe[token]
    out[token] = getComputedStyle(el).color
  }
  el.remove()
  return out
}

/** Resolve any CSS colour to a #rrggbb hex (for <input type=color> values). */
export function toHex(color: string): string {
  if (typeof document === 'undefined') return '#000000'
  // Rasterise a single pixel and read it back. We can't trust `fillStyle` or
  // `getComputedStyle().color` to *serialise* into sRGB — some Chromium builds
  // echo the source `oklch(…)` string, whose L/C/H would be misread as R/G/B.
  // Painting forces a real conversion into the canvas (sRGB) space, so
  // getImageData returns true bytes for oklch(), color-mix(), hex, named, etc.
  const cv = document.createElement('canvas')
  cv.width = cv.height = 1
  const ctx = cv.getContext('2d')
  if (!ctx) return '#000000'
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  const h = (n: number) => n.toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** Apply a theme: set the base (for semantic tokens) + derived neutral tokens. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.theme = theme.base
  const tokens = deriveTokens(theme.anchors, theme.base)
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v)
}

/** Remove any inline theme tokens (falls back to the CSS base defaults). */
export function clearThemeVars(): void {
  const root = document.documentElement
  for (const token of TOKEN_ORDER) root.style.removeProperty(token)
}

// ── Built-in skins (anchors chosen to read cleanly; Midnight/Paper mirror the
// original dark/light look) ─────────────────────────────────────────────────
export const BUILTIN_THEMES: Theme[] = [
  {
    id: 'midnight', name: 'Midnight', base: 'dark', builtin: true,
    anchors: { bg: 'oklch(0.168 0.006 285)', surface: 'oklch(0.198 0.006 285)', text: 'oklch(0.918 0.006 285)', border: 'oklch(0.270 0.006 285)', accent: 'oklch(0.64 0.11 300)' },
  },
  {
    id: 'paper', name: 'Paper', base: 'light', builtin: true,
    anchors: { bg: 'oklch(0.965 0.003 90)', surface: 'oklch(0.985 0.002 90)', text: 'oklch(0.245 0.008 285)', border: 'oklch(0.880 0.004 90)', accent: 'oklch(0.55 0.13 300)' },
  },
  {
    id: 'slate', name: 'Slate', base: 'dark', builtin: true,
    anchors: { bg: 'oklch(0.205 0.012 240)', surface: 'oklch(0.242 0.014 240)', text: 'oklch(0.925 0.008 240)', border: 'oklch(0.320 0.016 240)', accent: 'oklch(0.68 0.13 220)' },
  },
  {
    id: 'nord', name: 'Nord', base: 'dark', builtin: true,
    anchors: { bg: 'oklch(0.285 0.021 258)', surface: 'oklch(0.330 0.022 258)', text: 'oklch(0.925 0.014 240)', border: 'oklch(0.420 0.024 258)', accent: 'oklch(0.72 0.09 210)' },
  },
  {
    id: 'dusk', name: 'Dusk', base: 'dark', builtin: true,
    anchors: { bg: 'oklch(0.195 0.02 330)', surface: 'oklch(0.235 0.024 330)', text: 'oklch(0.930 0.012 330)', border: 'oklch(0.320 0.03 330)', accent: 'oklch(0.70 0.15 20)' },
  },
  {
    id: 'sepia', name: 'Sepia', base: 'light', builtin: true,
    anchors: { bg: 'oklch(0.930 0.024 75)', surface: 'oklch(0.960 0.02 75)', text: 'oklch(0.320 0.03 60)', border: 'oklch(0.850 0.03 75)', accent: 'oklch(0.55 0.12 45)' },
  },
  {
    id: 'contrast', name: 'High Contrast', base: 'dark', builtin: true,
    anchors: { bg: 'oklch(0.10 0 0)', surface: 'oklch(0.16 0 0)', text: 'oklch(0.99 0 0)', border: 'oklch(0.45 0 0)', accent: 'oklch(0.80 0.18 90)' },
  },
]

export function themeById(id: string, custom: Theme[]): Theme | undefined {
  return BUILTIN_THEMES.find((t) => t.id === id) ?? custom.find((t) => t.id === id)
}

// ── Import / export ──────────────────────────────────────────────────────────
export function exportTheme(theme: Theme): string {
  return JSON.stringify({ konbiniTheme: 1, name: theme.name, base: theme.base, anchors: theme.anchors }, null, 2)
}

export function importTheme(json: string): Theme | { error: string } {
  try {
    const o = JSON.parse(json)
    const a = o?.anchors
    if (!a || !a.bg || !a.surface || !a.text || !a.border || !a.accent) return { error: 'Missing anchor colours.' }
    const base: ThemeBase = o.base === 'light' ? 'light' : 'dark'
    return {
      id: `custom-${Date.now().toString(36)}`,
      name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : 'Imported theme',
      base,
      anchors: { bg: String(a.bg), surface: String(a.surface), text: String(a.text), border: String(a.border), accent: String(a.accent) },
    }
  } catch {
    return { error: 'Not valid theme JSON.' }
  }
}
