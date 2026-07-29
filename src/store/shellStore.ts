import { create } from 'zustand'
import type { ModalId, RecentEntry } from '@shared/types'
import { BUILTIN_THEMES, themeById, applyTheme, type Theme as ThemeDef } from '../lib/theme'

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
export type RailPanel = 'inspector' | 'comments' | 'assistant' | 'codex' | 'reader' | 'critic' | 'history' | null

export interface Toast { message: string; type: 'error' | 'info' | 'success'; id: number }

interface ShellState {
  screen: Screen
  platform: 'darwin' | 'win32' | 'linux'
  theme: Theme                   // the active theme's base (dark|light)
  themeId: string
  customThemes: ThemeDef[]
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
  /**
   * Name the rename modal opens pre-filled with. Transient: set alongside the
   * modal by whatever knew the name (a codex entry, a binder row), cleared
   * when the modal closes so the next ⌘K rename starts blank.
   */
  renameSeed: string
  toasts: Toast[]
  recents: RecentEntry[]
  layout: { binder: boolean }
  railPanel: RailPanel
  // actions
  setScreen: (s: Screen) => void
  setModal: (m: ModalId) => void
  /** Open the rename modal pre-filled with a name. */
  openRename: (name: string) => void
  setRailPanel: (p: RailPanel) => void
  toggleRailPanel: (p: Exclude<RailPanel, null>) => void
  setTheme: (t: Theme) => void
  setThemeId: (id: string) => void
  saveCustomTheme: (theme: ThemeDef) => void
  deleteCustomTheme: (id: string) => void
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

// Resolve the active theme on boot: prefer pref:themeId, else map the legacy
// dark/light pref, and migrate any legacy custom accent into a forked theme.
function initThemeState() {
  let customThemes: ThemeDef[] = []
  try { customThemes = JSON.parse(window.api.prefs.get('pref:customThemes') ?? '[]') } catch { /* ignore */ }
  const hadThemeId = !!window.api.prefs.get('pref:themeId')
  let themeId = window.api.prefs.get('pref:themeId') || ((window.api.prefs.get('pref:theme') === 'light') ? 'paper' : 'midnight')
  let active = themeById(themeId, customThemes) ?? BUILTIN_THEMES[0]
  const oldAccent = window.api.prefs.get('pref:accent')
  if (!hadThemeId && oldAccent && oldAccent !== active.anchors.accent) {
    active = { ...active, id: `custom-${Date.now().toString(36)}`, name: `${active.name} (yours)`, builtin: false, anchors: { ...active.anchors, accent: oldAccent } }
    customThemes = [...customThemes, active]
    themeId = active.id
    window.api.prefs.set('pref:customThemes', JSON.stringify(customThemes))
    window.api.prefs.set('pref:themeId', themeId)
  }
  applyTheme(active)
  return { theme: active.base as Theme, themeId, customThemes, accent: active.anchors.accent }
}
const THEME0 = initThemeState()

export const useShellStore = create<ShellState>((set, get) => ({
  screen: 'launch',
  platform: (window.api?.shell?.platform ?? 'linux') as 'darwin' | 'win32' | 'linux',
  theme: THEME0.theme,
  themeId: THEME0.themeId,
  customThemes: THEME0.customThemes,
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
  accent: THEME0.accent,
  modal: null,
  renameSeed: '',
  toasts: [],
  recents: [],
  layout: { binder: true },
  railPanel: 'inspector',

  setScreen: (screen) => set({ screen }),
  setModal: (modal) => set(modal === 'rename' ? { modal } : { modal, renameSeed: '' }),
  openRename: (renameSeed) => set({ renameSeed, modal: 'rename' }),
  setRailPanel: (railPanel) => set({ railPanel }),
  toggleRailPanel: (p) => set((s) => ({ railPanel: s.railPanel === p ? null : p })),
  // Base toggle (dark/light) picks the default skin for that base.
  setTheme: (theme) => {
    window.api.prefs.set('pref:theme', theme)
    get().setThemeId(theme === 'light' ? 'paper' : 'midnight')
  },
  setThemeId: (id) => {
    const theme = themeById(id, get().customThemes) ?? BUILTIN_THEMES[0]
    applyTheme(theme)
    window.api.prefs.set('pref:themeId', theme.id)
    set({ themeId: theme.id, theme: theme.base as Theme, accent: theme.anchors.accent })
  },
  saveCustomTheme: (theme) => {
    const list = get().customThemes
    const customThemes = list.some((t) => t.id === theme.id)
      ? list.map((t) => (t.id === theme.id ? theme : t))
      : [...list, theme]
    window.api.prefs.set('pref:customThemes', JSON.stringify(customThemes))
    applyTheme(theme)
    window.api.prefs.set('pref:themeId', theme.id)
    set({ customThemes, themeId: theme.id, theme: theme.base as Theme, accent: theme.anchors.accent })
  },
  deleteCustomTheme: (id) => {
    const customThemes = get().customThemes.filter((t) => t.id !== id)
    window.api.prefs.set('pref:customThemes', JSON.stringify(customThemes))
    if (get().themeId === id) {
      const fb = BUILTIN_THEMES[0]
      applyTheme(fb)
      window.api.prefs.set('pref:themeId', fb.id)
      set({ customThemes, themeId: fb.id, theme: fb.base as Theme, accent: fb.anchors.accent })
    } else {
      set({ customThemes })
    }
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
  // A quick accent change edits the active theme's accent — forking a built-in
  // skin into an editable copy so presets stay pristine.
  setAccent: (color) => {
    const active = themeById(get().themeId, get().customThemes) ?? BUILTIN_THEMES[0]
    const next: ThemeDef = active.builtin
      ? { ...active, id: `custom-${Date.now().toString(36)}`, name: `${active.name} (yours)`, builtin: false, anchors: { ...active.anchors, accent: color } }
      : { ...active, anchors: { ...active.anchors, accent: color } }
    get().saveCustomTheme(next)
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
