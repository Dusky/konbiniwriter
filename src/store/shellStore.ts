import { create } from 'zustand'
import type { ModalId, RecentEntry } from '@shared/types'

export type Screen = 'launch' | 'studio'
export type Theme = 'dark' | 'light'

interface ShellState {
  screen: Screen
  platform: 'darwin' | 'win32' | 'linux'
  theme: Theme
  modal: ModalId
  recents: RecentEntry[]
  layout: { binder: boolean; insp: boolean }
  // actions
  setScreen: (s: Screen) => void
  setModal: (m: ModalId) => void
  setTheme: (t: Theme) => void
  toggleBinder: () => void
  toggleInsp: () => void
  setRecents: (r: RecentEntry[]) => void
  touchRecent: (r: RecentEntry) => void
  removeRecent: (id: string) => void
}

export const useShellStore = create<ShellState>((set) => ({
  screen: 'launch',
  platform: (window.api?.shell?.platform ?? 'linux') as 'darwin' | 'win32' | 'linux',
  theme: 'dark',
  modal: null,
  recents: [],
  layout: { binder: true, insp: true },

  setScreen: (screen) => set({ screen }),
  setModal: (modal) => set({ modal }),
  setTheme: (theme) => {
    document.documentElement.dataset.theme = theme
    set({ theme })
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
