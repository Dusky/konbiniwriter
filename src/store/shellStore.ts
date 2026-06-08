import { create } from 'zustand'
import type { ModalId, RecentEntry } from '@shared/types'

export type Screen = 'launch' | 'studio'
export type Theme = 'dark' | 'light'
export type Density = 'compact' | 'balanced' | 'roomy'
export type EditorFont = 'mono' | 'serif' | 'sans'

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
  modal: ModalId
  recents: RecentEntry[]
  layout: { binder: boolean; insp: boolean }
  // actions
  setScreen: (s: Screen) => void
  setModal: (m: ModalId) => void
  setTheme: (t: Theme) => void
  setDensity: (d: Density) => void
  setEditorFont: (f: EditorFont) => void
  setEditorSize: (n: number) => void
  setTypewriterMode: (v: boolean) => void
  setAutoVersion: (v: boolean) => void
  setHistoryRetentionDays: (n: number) => void
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
  typewriterMode: (() => {
    try { return localStorage.getItem('pref:typewriterMode') === 'true' } catch { return false }
  })(),
  autoVersion: (() => {
    try { return localStorage.getItem('pref:autoVersion') !== 'false' } catch { return true }
  })(),
  historyRetentionDays: (() => {
    try { const n = parseInt(localStorage.getItem('pref:historyRetentionDays') ?? '14', 10); return isNaN(n) ? 14 : n } catch { return 14 }
  })(),
  modal: null,
  recents: [],
  layout: { binder: true, insp: true },

  setScreen: (screen) => set({ screen }),
  setModal: (modal) => set({ modal }),
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
    try { localStorage.setItem('pref:typewriterMode', String(typewriterMode)) } catch { /* noop */ }
    set({ typewriterMode })
  },
  setAutoVersion: (autoVersion) => {
    try { localStorage.setItem('pref:autoVersion', String(autoVersion)) } catch { /* noop */ }
    set({ autoVersion })
  },
  setHistoryRetentionDays: (historyRetentionDays) => {
    try { localStorage.setItem('pref:historyRetentionDays', String(historyRetentionDays)) } catch { /* noop */ }
    set({ historyRetentionDays })
  },
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
