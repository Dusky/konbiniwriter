// electron/preload.ts — contextBridge bridge to Node.js APIs.
//
// Runs in an isolated context with Node.js access. Exposes window.api to the
// renderer (React app) — the same shape as browserApi.ts so zero renderer changes.
//
// Electron migration note: this file replaces browserApi.ts entirely.
// The renderer always calls window.api.* — no code changes needed there.

import { contextBridge, ipcRenderer } from 'electron'
import * as path from 'path'
import * as fs from 'fs/promises'
import { nodeProjectService as svc } from './NodeProjectService'
import type { KonbiniAPI, RecentEntry } from '../src/shared/types'
import { wordCount } from '../src/shared/utils'

// ── Recents (stored in userData/recents.json) ─────────────────────────────────

let _userData: string | null = null
async function getUserData(): Promise<string> {
  if (!_userData) {
    const env = await ipcRenderer.invoke('app:env')
    _userData = env.userData
  }
  return _userData!
}

async function loadRecents(): Promise<RecentEntry[]> {
  try {
    const dir = await getUserData()
    const text = await fs.readFile(path.join(dir, 'recents.json'), 'utf-8')
    return JSON.parse(text)
  } catch { return [] }
}

async function saveRecents(recents: RecentEntry[]): Promise<void> {
  const dir = await getUserData()
  await fs.writeFile(path.join(dir, 'recents.json'), JSON.stringify(recents, null, 2), 'utf-8')
}

async function touchRecent(entry: Omit<RecentEntry, 'opened'>): Promise<void> {
  const recents = await loadRecents()
  const filtered = recents.filter(r => r.id !== entry.id)
  filtered.unshift({ ...entry, opened: Date.now() })
  await saveRecents(filtered.slice(0, 20))
}

async function removeRecent(id: string): Promise<void> {
  const recents = await loadRecents()
  await saveRecents(recents.filter(r => r.id !== id))
}

// ── API implementation ────────────────────────────────────────────────────────

const api: KonbiniAPI = {
  project: {
    async create(opts) {
      let location = opts.location
      // Open native directory picker if needed
      if (location === 'browser-pick' || location === 'node-pick') {
        const dir = await ipcRenderer.invoke('dialog:saveDir', opts.title)
        if (!dir) throw new DOMException('No folder selected.', 'AbortError')
        location = dir
      }
      const project = await svc.create({ ...opts, location })
      await touchRecent({
        id: project.id, title: project.title,
        location: project.settings.location,
        words: Object.values(project.docs).reduce((a, d) => a + wordCount(d.content), 0),
        template: project.settings.template,
        accent: project.settings.accent,
      })
      return project
    },

    async open(bundlePath) {
      const project = await svc.open(bundlePath)
      await touchRecent({
        id: project.id, title: project.title,
        location: project.settings.location,
        words: Object.values(project.docs).reduce((a, d) => a + wordCount(d.content), 0),
        template: project.settings.template,
        accent: project.settings.accent,
      })
      return project
    },

    // Electron reopens recents by real path — no handle persistence needed.
    async openRecent(_id, location) {
      const project = await svc.open(location)
      await touchRecent({
        id: project.id, title: project.title,
        location: project.settings.location,
        words: Object.values(project.docs).reduce((a, d) => a + wordCount(d.content), 0),
        template: project.settings.template,
        accent: project.settings.accent,
      })
      return project
    },

    recents: loadRecents,

    close: (id) => svc.close(id),

    removeRecent: async (id) => removeRecent(id),

    showOpenDialog: async () => {
      // Returns the path to a .konbini bundle directory (the user selects the bundle dir)
      const result: string | null = await ipcRenderer.invoke('dialog:openDir')
      return result
    },

    showSaveDialog: async (name) => {
      const result: string | null = await ipcRenderer.invoke('dialog:saveDir', name)
      return result
    },
  },

  doc: {
    read: (pid, nid) => svc.readDoc(pid, nid),
    write: (pid, nid, content) => svc.writeDoc(pid, nid, content),
  },

  node: {
    mutate: (pid, op) => svc.mutateNode(pid, op),
  },

  snapshot: {
    take: (pid, nid, title, kind) => svc.takeSnapshot(pid, nid, title, kind),
    restore: (pid, nid, sid) => svc.restoreSnapshot(pid, nid, sid),
    list: (pid, nid) => svc.listSnapshots(pid, nid),
    delete: (pid, nid, sid) => svc.deleteSnapshot(pid, nid, sid),
  },

  codex: {
    save: (pid, entries) => svc.saveCodex(pid, entries),
  },

  settings: {
    save: (pid, patch) => svc.saveSettings(pid, patch),
  },

  compile: {
    run: (pid, rid, ids, fmt) => svc.compile(pid, rid, ids, fmt),
  },

  prefs: {
    get: (key: string) => { try { return localStorage.getItem(key) } catch { return null } },
    set: (key: string, value: string) => {
      try {
        localStorage.setItem(key, value)
      } catch (e) {
        console.error('prefs.set failed', key, e)
        window.dispatchEvent(new CustomEvent('konbini:prefs-error'))
      }
    },
    remove: (key: string) => { try { localStorage.removeItem(key) } catch { /* noop */ } },
  },

  shell: {
    platform: process.platform as 'darwin' | 'win32' | 'linux',
    minimize: () => { ipcRenderer.invoke('shell:minimize') },
    maximize: () => { ipcRenderer.invoke('shell:maximize') },
    close: () => { ipcRenderer.invoke('shell:close') },
    isMaximized: () => ipcRenderer.invoke('shell:isMaximized'),
    onMaximizeChange: (cb: (maximized: boolean) => void) => {
      const handler = (_e: unknown, maximized: boolean) => cb(maximized)
      ipcRenderer.on('shell:maximized', handler)
      return () => { ipcRenderer.removeListener('shell:maximized', handler) }
    },
  },
}

contextBridge.exposeInMainWorld('api', api)
