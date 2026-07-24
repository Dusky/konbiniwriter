import { create } from 'zustand'
import type { ModalId, RecentEntry } from '@shared/types'

export type Screen = 'launch' | 'studio'
export type Theme = 'dark' | 'light'
export type Density = 'compact' | 'balanced' | 'roomy'
export type EditorFont = 'mono' | 'serif' | 'sans'

/** Widgets that can appear on the per-pane editor footer bar. */
export type EditorBarWidget = 'render' | 'words' | 'chars' | 'cursor' | 'reading' | 'target' | 'focus' | 'typewriter'
export interface EditorBarItem { id: EditorBarWidget; visible: boolean }
export const EDITOR_BAR_DEFAULT: EditorBarItem[] = [
  { id: 'render', visible: true },
  { id: 'words', visible: true },
  { id: 'cursor', visible: true },
  { id: 'reading', visible: false },
  { id: 'chars', visible: false },
  { id: 'target', visible: false },
  { id: 'focus', visible: false },
  { id: 'typewriter', visible: false },
]

// Keep a stored config forward-compatible: drop unknown ids, append any newly
// added widgets (hidden) so old prefs still surface new features.
function normalizeEditorBar(items: EditorBarItem[]): EditorBarItem[] {
  const known = new Set(EDITOR_BAR_DEFAULT.map((i) => i.id))
  const seen = new Set<EditorBarWidget>()
  const out = items.filter((i) => known.has(i.id) && !seen.has(i.id) && seen.add(i.id))
  for (const d of EDITOR_BAR_DEFAULT) if (!seen.has(d.id)) out.push({ ...d, visible: false })
  return out
}
/** The single panel shown in the tabbed right rail (null = rail closed). */
export type RailPanel = 'inspector' | 'assistant' | 'codex' | 'reader' | 'critic' | null

export interface Toast { message: string; type: 'error' | 'info' | 'success'; id: number }

interface ShellState {
  screen: Screen
  platform: 'darwin' | 'win32' | 'linux'
  theme: Theme
  density: Density
  editorFont: EditorFont
  editorSize: number
  editorColWidth: number
  typewriterMode: boolean
  livePreview: boolean           // false = show raw markdown in the editor
  editorBar: EditorBarItem[]
  autoVersion: boolean
  historyRetentionDays: number   // 0 = keep forever
  accent: string
  modal: ModalId
  toasts: Toast[]
  recents: RecentEntry[]
  layout: { binder: boolean }
  railPanel: RailPanel
  // actions
  setScreen: (s: Screen) => void
  setModal: (m: ModalId) => void
  setRailPanel: (p: RailPanel) => void
  toggleRailPanel: (p: Exclude<RailPanel, null>) => void
  setTheme: (t: Theme) => void
  setDensity: (d: Density) => void
  setEditorFont: (f: EditorFont) => void
  setEditorSize: (n: number) => void
  setEditorColWidth: (n: number) => void
  setTypewriterMode: (v: boolean) => void
  setLivePreview: (v: boolean) => void
  setEditorBar: (items: EditorBarItem[]) => void
  setEditorBarItem: (id: EditorBarWidget, visible: boolean) => void
  resetEditorBar: () => void
  setAutoVersion: (v: boolean) => void
  setHistoryRetentionDays: (n: number) => void
  setAccent: (color: string) => void
  setToast: (message: string, type?: Toast['type']) => void
  clearToast: (id?: number) => void
  toggleBinder: () => void
  setRecents: (r: RecentEntry[]) => void
  touchRecent: (r: RecentEntry) => void
  removeRecent: (id: string) => void
}

const FONT_MAP: Record<string, string> = {
  mono: "'IBM Plex Mono', ui-monospace, monospace",
  serif: "Spectral, 'Georgia', ui-serif, serif",
  sans: "'IBM Plex Sans', system-ui, sans-serif",
}

export const useShellStore = create<ShellState>((set) => ({
  screen: 'launch',
  platform: (window.api?.shell?.platform ?? 'linux') as 'darwin' | 'win32' | 'linux',
  theme: (() => {
    const t = (window.api.prefs.get('pref:theme') as Theme) || 'dark'
    document.documentElement.dataset.theme = t
    return t
  })(),
  density: (() => {
    const d = (window.api.prefs.get('pref:density') as Density) || 'balanced'
    document.documentElement.dataset.density = d
    return d
  })(),
  editorFont: (() => {
    const f = (window.api.prefs.get('pref:editorFont') as EditorFont) || 'serif'
    document.documentElement.style.setProperty('--editor-font', FONT_MAP[f])
    return f
  })(),
  editorSize: (() => {
    const n = parseInt(window.api.prefs.get('pref:editorSize') ?? '17', 10)
    const size = isNaN(n) ? 17 : n
    document.documentElement.style.setProperty('--editor-size', `${size}px`)
    return size
  })(),
  editorColWidth: (() => {
    const n = parseInt(window.api.prefs.get('pref:editorColWidth') ?? '720', 10)
    const w = isNaN(n) ? 720 : n
    if (w !== 720) document.documentElement.style.setProperty('--editor-col-w', w + 'px')
    return w
  })(),
  typewriterMode: window.api.prefs.get('pref:typewriterMode') === 'true',
  livePreview: window.api.prefs.get('pref:livePreview') !== 'false',
  editorBar: (() => {
    try {
      const raw = window.api.prefs.get('pref:editorBar')
      if (raw) return normalizeEditorBar(JSON.parse(raw) as EditorBarItem[])
    } catch { /* fall through to default */ }
    return EDITOR_BAR_DEFAULT
  })(),
  autoVersion: window.api.prefs.get('pref:autoVersion') !== 'false',
  historyRetentionDays: (() => {
    const n = parseInt(window.api.prefs.get('pref:historyRetentionDays') ?? '14', 10)
    return isNaN(n) ? 14 : n
  })(),
  accent: (() => {
    const saved = window.api.prefs.get('pref:accent')
    const color = saved || 'oklch(0.64 0.11 300)'
    if (saved) document.documentElement.style.setProperty('--accent', color)
    return color
  })(),
  modal: null,
  toasts: [],
  recents: [],
  layout: { binder: true },
  railPanel: 'inspector',

  setScreen: (screen) => set({ screen }),
  setModal: (modal) => set({ modal }),
  setRailPanel: (railPanel) => set({ railPanel }),
  toggleRailPanel: (p) => set((s) => ({ railPanel: s.railPanel === p ? null : p })),
  setTheme: (theme) => {
    window.api.prefs.set('pref:theme', theme)
    document.documentElement.dataset.theme = theme
    set({ theme })
  },
  setDensity: (density) => {
    window.api.prefs.set('pref:density', density)
    document.documentElement.dataset.density = density
    set({ density })
  },
  setEditorFont: (editorFont) => {
    window.api.prefs.set('pref:editorFont', editorFont)
    document.documentElement.style.setProperty('--editor-font', FONT_MAP[editorFont])
    set({ editorFont })
  },
  setEditorSize: (editorSize) => {
    window.api.prefs.set('pref:editorSize', String(editorSize))
    document.documentElement.style.setProperty('--editor-size', `${editorSize}px`)
    set({ editorSize })
  },
  setEditorColWidth: (editorColWidth) => {
    window.api.prefs.set('pref:editorColWidth', String(editorColWidth))
    document.documentElement.style.setProperty('--editor-col-w', `${editorColWidth}px`)
    set({ editorColWidth })
  },
  setTypewriterMode: (typewriterMode) => {
    window.api.prefs.set('pref:typewriterMode', String(typewriterMode))
    set({ typewriterMode })
  },
  setLivePreview: (livePreview) => {
    window.api.prefs.set('pref:livePreview', String(livePreview))
    set({ livePreview })
  },
  setEditorBar: (editorBar) => {
    window.api.prefs.set('pref:editorBar', JSON.stringify(editorBar))
    set({ editorBar })
  },
  setEditorBarItem: (id, visible) => set((s) => {
    const editorBar = s.editorBar.map((i) => (i.id === id ? { ...i, visible } : i))
    window.api.prefs.set('pref:editorBar', JSON.stringify(editorBar))
    return { editorBar }
  }),
  resetEditorBar: () => {
    window.api.prefs.set('pref:editorBar', JSON.stringify(EDITOR_BAR_DEFAULT))
    set({ editorBar: EDITOR_BAR_DEFAULT })
  },
  setAutoVersion: (autoVersion) => {
    window.api.prefs.set('pref:autoVersion', String(autoVersion))
    set({ autoVersion })
  },
  setHistoryRetentionDays: (historyRetentionDays) => {
    window.api.prefs.set('pref:historyRetentionDays', String(historyRetentionDays))
    set({ historyRetentionDays })
  },
  setAccent: (accent) => {
    window.api.prefs.set('pref:accent', accent)
    document.documentElement.style.setProperty('--accent', accent)
    set({ accent })
  },
  // Stack up to 3 toasts so a second failure doesn't erase the first.
  setToast: (message, type = 'error') => set((s) => ({
    toasts: [...s.toasts, { message, type, id: Date.now() + Math.random() }].slice(-3),
  })),
  clearToast: (id) => set((s) => ({ toasts: id === undefined ? [] : s.toasts.filter((t) => t.id !== id) })),
  toggleBinder: () => set((s) => ({ layout: { ...s.layout, binder: !s.layout.binder } })),
  setRecents: (recents) => set({ recents }),
  touchRecent: (r) =>
    set((s) => ({
      recents: [r, ...s.recents.filter((x) => x.id !== r.id)].slice(0, 10),
    })),
  removeRecent: (id) =>
    set((s) => ({ recents: s.recents.filter((r) => r.id !== id) })),
}))
