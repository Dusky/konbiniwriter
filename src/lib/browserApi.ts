// browserApi.ts — assigns window.api for the browser runtime.
//
// Electron migration: this file is replaced by the contextBridge preload.
// Every component already calls window.api — nothing else changes.

import type { KonbiniAPI } from '@shared/types'
import { isFileSystemAccessSupported, browserProjectService } from './BrowserProjectService'
import { isOPFSSupported, opfsProjectService } from './OPFSProjectService'
import { recentsService } from './RecentsService'

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
    recents: async () => recentsService.getAll(),
    close: (id) => svc.close(id),
    removeRecent: async (id) => { recentsService.remove(id) },
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
    take: (pid, nid, title) => svc.takeSnapshot(pid, nid, title),
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
  // Browser has no native window chrome — these are no-ops here.
  // Electron preload replaces them with real IPC calls.
  shell: {
    platform: 'linux',
    minimize: () => {},
    maximize: () => {},
    close: () => window.close(),
    isMaximized: async () => false,
  },
}

// Expose globally so all components can call window.api unchanged
;(window as unknown as { api: KonbiniAPI }).api = api
