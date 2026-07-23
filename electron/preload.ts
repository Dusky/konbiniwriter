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
import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs'
import { nodeProjectService as svc } from './NodeProjectService'
import type { KonbiniAPI, RecentEntry } from '../src/shared/types'
import { wordCount } from '../src/shared/utils'

// ── Preferences (userData/prefs.json) ─────────────────────────────────────────
// localStorage on the packaged app's file:// origin does not reliably survive an
// Electron restart, so settings/AI config appeared to "not save". Back prefs
// with a real file instead. The store layer reads prefs synchronously at
// construction, so get/set are synchronous over an in-memory cache; writes are
// debounced and flushed on page hide (and are atomic via tmp+rename).

let _prefs: Record<string, string> | null = null
let _prefsPath = ''
let _prefsTimer: ReturnType<typeof setTimeout> | null = null

function prefsFile(): string {
  if (!_prefsPath) _prefsPath = path.join(ipcRenderer.sendSync('app:userDataSync') as string, 'prefs.json')
  return _prefsPath
}

function loadPrefs(): Record<string, string> {
  if (_prefs) return _prefs
  let data: Record<string, string> = {}
  try { data = JSON.parse(readFileSync(prefsFile(), 'utf-8')) } catch { data = {} }
  // One-time migration from the old localStorage-backed prefs.
  if (Object.keys(data).length === 0) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k != null) { const v = localStorage.getItem(k); if (v != null) data[k] = v }
      }
    } catch { /* localStorage may be unavailable */ }
    _prefs = data
    if (Object.keys(data).length > 0) flushPrefs()
    return _prefs
  }
  _prefs = data
  return _prefs
}

function flushPrefs(): void {
  if (!_prefs) return
  const p = prefsFile()
  const tmp = `${p}.tmp-${process.pid}`
  try {
    writeFileSync(tmp, JSON.stringify(_prefs, null, 2), 'utf-8')
    renameSync(tmp, p)
  } catch (e) {
    try { unlinkSync(tmp) } catch { /* noop */ }
    console.error('prefs write failed', e)
    window.dispatchEvent(new CustomEvent('konbini:prefs-error'))
  }
}

function schedulePrefsFlush(): void {
  if (_prefsTimer) clearTimeout(_prefsTimer)
  _prefsTimer = setTimeout(() => { _prefsTimer = null; flushPrefs() }, 250)
}

// ── Secrets at rest ───────────────────────────────────────────────────────────
// API keys and OAuth tokens are encrypted (OS keychain via safeStorage in main)
// before being written to prefs.json. Stored encrypted values carry a marker;
// plaintext from an older install decrypts to itself and is re-encrypted on next
// write. If encryption is unavailable (some Linux setups) we fall back to plaintext.
const SECRET_SUFFIXES = [':anthropicKey', ':openaiKey', ':oauthAccessToken', ':oauthRefreshToken']
const SAFE_PREFIX = 'safe:v1:'
let _secretAvail: boolean | null = null

function isSecret(key: string): boolean {
  return SECRET_SUFFIXES.some((s) => key.endsWith(s))
}
function secretAvailable(): boolean {
  if (_secretAvail === null) {
    try { _secretAvail = ipcRenderer.sendSync('secret:available') === true } catch { _secretAvail = false }
  }
  return _secretAvail
}
function encryptSecret(plain: string): string {
  if (!plain || !secretAvailable()) return plain
  try {
    const b64 = ipcRenderer.sendSync('secret:encrypt', plain) as string | null
    return b64 ? SAFE_PREFIX + b64 : plain
  } catch { return plain }
}
function decryptSecret(stored: string): string {
  if (!stored.startsWith(SAFE_PREFIX)) return stored
  try {
    const plain = ipcRenderer.sendSync('secret:decrypt', stored.slice(SAFE_PREFIX.length)) as string | null
    return plain ?? ''
  } catch { return '' }
}

// Never lose the last change if the window closes before the debounce fires.
window.addEventListener('pagehide', () => {
  if (_prefsTimer) { clearTimeout(_prefsTimer); _prefsTimer = null }
  flushPrefs()
})

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
  const p = path.join(dir, 'recents.json')
  const tmp = `${p}.tmp-${process.pid}`
  try {
    await fs.writeFile(tmp, JSON.stringify(recents, null, 2), 'utf-8')
    await fs.rename(tmp, p)
  } catch (e) {
    await fs.unlink(tmp).catch(() => {})
    throw e
  }
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
    onConflict: (cb) => svc.onConflict(cb),
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
    get: (key: string) => {
      const p = loadPrefs()
      if (!Object.prototype.hasOwnProperty.call(p, key)) return null
      return isSecret(key) ? decryptSecret(p[key]) : p[key]
    },
    set: (key: string, value: string) => {
      loadPrefs()[key] = isSecret(key) ? encryptSecret(value) : value
      schedulePrefsFlush()
    },
    remove: (key: string) => { delete loadPrefs()[key]; schedulePrefsFlush() },
  },

  aux: {
    read: (pid: string, name: string) => svc.readAux(pid, name),
    write: (pid: string, name: string, content: string) => svc.writeAux(pid, name, content),
    remove: (pid: string, name: string) => svc.removeAux(pid, name),
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
    openExternal: (url: string) => { ipcRenderer.invoke('shell:openExternal', url) },
  },

  oauth: {
    exchange: (input) => ipcRenderer.invoke('oauth:exchange', input),
    refresh: (input) => ipcRenderer.invoke('oauth:refresh', input),
    streamMessages: (input, handlers) => {
      let reqId = -1
      let channel = ''
      const listener = (_e: unknown, msg: { type: string; data?: string; status?: number; body?: string }) => {
        if (msg.type === 'chunk') handlers.onChunk(msg.data ?? '')
        else if (msg.type === 'done') { cleanup(); handlers.onDone() }
        else if (msg.type === 'aborted') { cleanup(); handlers.onAbort ? handlers.onAbort() : handlers.onDone() }
        else if (msg.type === 'error') { cleanup(); handlers.onError({ status: msg.status, body: msg.body }) }
      }
      const cleanup = () => { if (channel) ipcRenderer.removeListener(channel, listener) }
      // start (reserve id) → attach listener → go (begin streaming) so no chunk is missed.
      void (async () => {
        try {
          reqId = await ipcRenderer.invoke('oauth:messages:start', input) as number
          channel = `oauth:messages:${reqId}`
          ipcRenderer.on(channel, listener)
          await ipcRenderer.invoke('oauth:messages:go', reqId)
        } catch (e) {
          handlers.onError({ body: (e as Error).message })
        }
      })()
      return { abort: () => { if (reqId >= 0) ipcRenderer.invoke('oauth:messages:abort', reqId) } }
    },
  },
}

contextBridge.exposeInMainWorld('api', api)
