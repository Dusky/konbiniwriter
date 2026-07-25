// browserApi.ts — assigns window.api for the browser runtime.
//
// Electron migration: this file is replaced by the contextBridge preload.
// Every component already calls window.api — nothing else changes.

import type { KonbiniAPI, Project, OAuthTokenResult } from '@shared/types'
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
    async import(opts) {
      const project = await svc.import(opts)
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
  debt: {
    save: (pid, items) => svc.saveDebt(pid, items),
  },
  sync: {
    probe: (pid) => svc.probe(pid),
    readBundle: (pid) => svc.readBundle(pid),
    applyMerge: (pid, merged) => svc.applyMerge(pid, merged),
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
  aux: {
    read: (pid, name) => svc.readAux(pid, name),
    write: (pid, name, content) => svc.writeAux(pid, name, content),
    remove: (pid, name) => svc.removeAux(pid, name),
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
    openExternal: (url) => { window.open(url, '_blank', 'noopener,noreferrer') },
  },

  // Claude OAuth token endpoint. Called directly here (best-effort — the browser
  // build is subject to the endpoint's CORS policy); the Electron preload proxies
  // it through the main process instead. See ClaudeOAuth.ts.
  oauth: {
    exchange: (input) => postToken({
      grant_type: 'authorization_code',
      code: input.code,
      state: input.state,
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
    }),
    refresh: (input) => postToken({
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
      client_id: OAUTH_CLIENT_ID,
    }),
    // A browser page can't call the Messages API with a subscription token —
    // Anthropic rejects the browser Origin and CORS blocks it. Desktop only.
    streamMessages: (_input, handlers) => {
      handlers.onError({ body: 'Claude subscription chat requires the Konbini desktop app. Use an API key in the browser build.' })
      return { abort: () => {} }
    },
  },
}

const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token'

async function postToken(payload: Record<string, string>): Promise<OAuthTokenResult> {
  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    })
    const text = await res.text()
    let data: { error?: string; error_description?: string; access_token?: string; refresh_token?: string; expires_in?: number } = {}
    try { data = JSON.parse(text) } catch { /* non-JSON error body */ }
    if (!res.ok) {
      const detail = [data.error, data.error_description].filter(Boolean).join(': ')
      return { ok: false, error: `${detail || text.slice(0, 200) || 'request failed'} (HTTP ${res.status})` }
    }
    return { ok: true, accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// Expose globally so all components can call window.api unchanged.
// Under Electron, the preload already installed a (read-only) window.api via
// contextBridge — don't clobber it (assigning would throw). Only the browser
// runtime needs this fallback.
if (!(window as unknown as { api?: KonbiniAPI }).api) {
  ;(window as unknown as { api: KonbiniAPI }).api = api
}
