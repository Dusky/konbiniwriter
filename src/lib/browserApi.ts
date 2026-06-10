// browserApi.ts — assigns window.api for the browser runtime.
//
// Electron migration: this file is replaced by the contextBridge preload.
// Every component already calls window.api — nothing else changes.

import type { KonbiniAPI, Project } from '@shared/types'
import { isFileSystemAccessSupported, browserProjectService } from './BrowserProjectService'
import { isOPFSSupported, opfsProjectService } from './OPFSProjectService'
import { recentsService } from './RecentsService'
import { handleStore } from './HandleStore'

// Use FSA (Chrome/Edge) if available, fall back to OPFS (Firefox/Safari)
const svc = isFileSystemAccessSupported() ? browserProjectService : opfsProjectService
import { wordCount } from '@shared/utils'

const api: KonbiniAPI = {
  project: {
    async create(opts) {
      const project = await svc.create(opts)
      recentsService.touch({
        id: project.id, title: project.title,
        location: project.settings.location,
        words: Object.values(project.docs).reduce((a, d) => a + wordCount(d.content), 0),
        template: project.settings.template,
        accent: project.settings.accent,
      })
      return project
    },
    async open(handleKey) {
      const project = await svc.open(handleKey)
      recentsService.touch({
        id: project.id, title: project.title,
        location: project.settings.location,
        words: Object.values(project.docs).reduce((a, d) => a + wordCount(d.content), 0),
        template: project.settings.template,
        accent: project.settings.accent,
      })
      return project
    },
    async openRecent(id, location) {
      // Chrome/Edge: try the persisted FSA handle first (no picker). Falls
      // through to a location open — which, on FSA, throws if no handle is
      // available, letting the caller surface the folder picker instead.
      let project: Project | null = null
      if (svc === browserProjectService) {
        project = await browserProjectService.openByHandle(id)
      }
      if (!project) project = await svc.open(location)
      recentsService.touch({
        id: project.id, title: project.title,
        location: project.settings.location,
        words: Object.values(project.docs).reduce((a, d) => a + wordCount(d.content), 0),
        template: project.settings.template,
        accent: project.settings.accent,
      })
      return project
    },
    recents: async () => recentsService.getAll(),
    close: (id) => svc.close(id),
    removeRecent: async (id) => { recentsService.remove(id); void handleStore.del(id) },
    showOpenDialog: () => svc.showOpenDialog(),
    showSaveDialog: (name) => svc.showSaveDialog(name),
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
    get: (key) => { try { return localStorage.getItem(key) } catch { return null } },
    set: (key, value) => {
      try {
        localStorage.setItem(key, value)
      } catch (e) {
        console.error('prefs.set failed', key, e)
        window.dispatchEvent(new CustomEvent('konbini:prefs-error'))
      }
    },
    remove: (key) => { try { localStorage.removeItem(key) } catch { /* noop */ } },
  },
  // Browser has no native window chrome — no-ops here.
  // Electron preload replaces them with real IPC calls.
  shell: {
    platform: (/Mac|iPhone|iPod|iPad/.test(navigator.platform) ? 'darwin'
      : /Win/.test(navigator.platform) ? 'win32' : 'linux') as 'darwin' | 'win32' | 'linux',
    minimize: () => {},
    maximize: () => {},
    close: () => window.close(),
    isMaximized: async () => false,
    onMaximizeChange: () => () => {},
  },
}

// Expose globally so all components can call window.api unchanged.
// Under Electron, the preload already installed a (read-only) window.api via
// contextBridge — don't clobber it (assigning would throw). Only the browser
// runtime needs this fallback.
if (!(window as unknown as { api?: KonbiniAPI }).api) {
  ;(window as unknown as { api: KonbiniAPI }).api = api
}
