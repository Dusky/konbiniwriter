// RecentsService — localStorage-backed recents registry.
// Electron migration: swap localStorage for a file in userData/.

import type { RecentEntry } from '@shared/types'

const KEY = 'konbini_recents_v1'
const MAX = 10

function load(): RecentEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] }
}

function save(entries: RecentEntry[]): void {
  localStorage.setItem(KEY, JSON.stringify(entries))
}

export const recentsService = {
  getAll(): RecentEntry[] { return load() },

  touch(entry: Omit<RecentEntry, 'opened'>): void {
    const prev = load().filter(r => r.id !== entry.id)
    save([{ ...entry, opened: Date.now() }, ...prev].slice(0, MAX))
  },

  remove(id: string): void { save(load().filter(r => r.id !== id)) },
}
