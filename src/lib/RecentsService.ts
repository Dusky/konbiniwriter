// RecentsService — prefs-seam-backed recents registry (browser runtime).
// Electron replaces this entirely via the preload's file-based recents.

import type { RecentEntry } from '@shared/types'

const KEY = 'konbini_recents_v1'
const MAX = 10

function load(): RecentEntry[] {
  try { return JSON.parse(window.api.prefs.get(KEY) ?? '[]') } catch { return [] }
}

function save(entries: RecentEntry[]): void {
  window.api.prefs.set(KEY, JSON.stringify(entries))
}

export const recentsService = {
  getAll(): RecentEntry[] { return load() },

  touch(entry: Omit<RecentEntry, 'opened'>): void {
    const prev = load().filter(r => r.id !== entry.id)
    save([{ ...entry, opened: Date.now() }, ...prev].slice(0, MAX))
  },

  remove(id: string): void { save(load().filter(r => r.id !== id)) },
}
