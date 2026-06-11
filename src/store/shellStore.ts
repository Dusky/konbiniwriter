import { create } from 'zustand'
import type { ModalId, RecentEntry } from '@shared/types'

export type Screen = 'launch' | 'studio'
export type Theme = 'dark' | 'light'
export type Density = 'compact' | 'balanced' | 'roomy'
export type EditorFont = 'mono' | 'serif' | 'sans'

export interface Toast { message: string; type: 'error' | 'info' | 'success'; id: number }

interface ShellState {
  screen: Screen
  platform: 'darwin' | 'win32' | 'linux'
  theme: Theme
  density: Density
  editorFont: EditorFont
  editorSize: number
  typewriterMode: boolean
  autoVersion: boolean
  historyRetentionDays: number   // 0 = keep forever
  accent: string
  modal: ModalId
  toast: Toast | null
  recents: RecentEntry[]
  layout: { binder: boolean; insp: boolean }
  assistantOpen: boolean
  // actions
  setScreen: (s: Screen) => void
  setModal: (m: ModalId) => void
  toggleAssistant: () => void
  setAssistantOpen: (open: boolean) => void
  setTheme: (t: Theme) => void
  setDensity: (d: Density) => void
  setEditorFont: (f: EditorFont) => void
  setEditorSize: (n: number) => void
  setTypewriterMode: (v: boolean) => void
  setAutoVersion: (v: boolean) => void
  setHistoryRetentionDays: (n: number) => void
  setAccent: (color: string) => void
  setToast: (message: string, type?: Toast['type']) => void
  clearToast: () => void
  toggleBinder: () => void
  toggleInsp: () => void
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
  theme: 'dark',
  density: 'balanced',
  editorFont: 'mono',
  editorSize: 17,
  typewriterMode: window.api.prefs.get('pref:typewriterMode') === 'true',
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
  toast: null,
  recents: [],
  layout: { binder: true, insp: true },
  assistantOpen: false,

  setScreen: (screen) => set({ screen }),
  setModal: (modal) => set({ modal }),
  toggleAssistant: () => set((s) => ({ assistantOpen: !s.assistantOpen })),
  setAssistantOpen: (assistantOpen) => set({ assistantOpen }),
  setTheme: (theme) => {
    document.documentElement.dataset.theme = theme
    set({ theme })
  },
  setDensity: (density) => {
    document.documentElement.dataset.density = density
    set({ density })
  },
  setEditorFont: (editorFont) => {
    document.documentElement.style.setProperty('--editor-font', FONT_MAP[editorFont])
    set({ editorFont })
  },
  setEditorSize: (editorSize) => {
    document.documentElement.style.setProperty('--editor-size', `${editorSize}px`)
    set({ editorSize })
  },
  setTypewriterMode: (typewriterMode) => {
    window.api.prefs.set('pref:typewriterMode', String(typewriterMode))
    set({ typewriterMode })
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
  setToast: (message, type = 'error') => set({ toast: { message, type, id: Date.now() } }),
  clearToast: () => set({ toast: null }),
  toggleBinder: () => set((s) => ({ layout: { ...s.layout, binder: !s.layout.binder } })),
  toggleInsp: () => set((s) => ({ layout: { ...s.layout, insp: !s.layout.insp } })),
  setRecents: (recents) => set({ recents }),
  touchRecent: (r) =>
    set((s) => ({
      recents: [r, ...s.recents.filter((x) => x.id !== r.id)].slice(0, 10),
    })),
  removeRecent: (id) =>
    set((s) => ({ recents: s.recents.filter((r) => r.id !== id) })),
}))
