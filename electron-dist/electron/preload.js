"use strict";
// electron/preload.ts — contextBridge bridge to Node.js APIs.
//
// Runs in an isolated context with Node.js access. Exposes window.api to the
// renderer (React app) — the same shape as browserApi.ts so zero renderer changes.
//
// Electron migration note: this file replaces browserApi.ts entirely.
// The renderer always calls window.api.* — no code changes needed there.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
const fs_1 = require("fs");
const NodeProjectService_1 = require("./NodeProjectService");
const utils_1 = require("../src/shared/utils");
// ── Preferences (userData/prefs.json) ─────────────────────────────────────────
// localStorage on the packaged app's file:// origin does not reliably survive an
// Electron restart, so settings/AI config appeared to "not save". Back prefs
// with a real file instead. The store layer reads prefs synchronously at
// construction, so get/set are synchronous over an in-memory cache; writes are
// debounced and flushed on page hide (and are atomic via tmp+rename).
let _prefs = null;
let _prefsPath = '';
let _prefsTimer = null;
function prefsFile() {
    if (!_prefsPath)
        _prefsPath = path.join(electron_1.ipcRenderer.sendSync('app:userDataSync'), 'prefs.json');
    return _prefsPath;
}
function loadPrefs() {
    if (_prefs)
        return _prefs;
    let data = {};
    try {
        data = JSON.parse((0, fs_1.readFileSync)(prefsFile(), 'utf-8'));
    }
    catch {
        data = {};
    }
    // One-time migration from the old localStorage-backed prefs.
    if (Object.keys(data).length === 0) {
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k != null) {
                    const v = localStorage.getItem(k);
                    if (v != null)
                        data[k] = v;
                }
            }
        }
        catch { /* localStorage may be unavailable */ }
        _prefs = data;
        if (Object.keys(data).length > 0)
            flushPrefs();
        return _prefs;
    }
    _prefs = data;
    return _prefs;
}
function flushPrefs() {
    if (!_prefs)
        return;
    const p = prefsFile();
    const tmp = `${p}.tmp-${process.pid}`;
    try {
        (0, fs_1.writeFileSync)(tmp, JSON.stringify(_prefs, null, 2), 'utf-8');
        (0, fs_1.renameSync)(tmp, p);
    }
    catch (e) {
        try {
            (0, fs_1.unlinkSync)(tmp);
        }
        catch { /* noop */ }
        console.error('prefs write failed', e);
        window.dispatchEvent(new CustomEvent('konbini:prefs-error'));
    }
}
function schedulePrefsFlush() {
    if (_prefsTimer)
        clearTimeout(_prefsTimer);
    _prefsTimer = setTimeout(() => { _prefsTimer = null; flushPrefs(); }, 250);
}
// ── Secrets at rest ───────────────────────────────────────────────────────────
// API keys and OAuth tokens are encrypted (OS keychain via safeStorage in main)
// before being written to prefs.json. Stored encrypted values carry a marker;
// plaintext from an older install decrypts to itself and is re-encrypted on next
// write. If encryption is unavailable (some Linux setups) we fall back to plaintext.
const SECRET_SUFFIXES = [':anthropicKey', ':openaiKey', ':oauthAccessToken', ':oauthRefreshToken'];
const SAFE_PREFIX = 'safe:v1:';
let _secretAvail = null;
function isSecret(key) {
    return SECRET_SUFFIXES.some((s) => key.endsWith(s));
}
function secretAvailable() {
    if (_secretAvail === null) {
        try {
            _secretAvail = electron_1.ipcRenderer.sendSync('secret:available') === true;
        }
        catch {
            _secretAvail = false;
        }
    }
    return _secretAvail;
}
function encryptSecret(plain) {
    if (!plain || !secretAvailable())
        return plain;
    try {
        const b64 = electron_1.ipcRenderer.sendSync('secret:encrypt', plain);
        return b64 ? SAFE_PREFIX + b64 : plain;
    }
    catch {
        return plain;
    }
}
function decryptSecret(stored) {
    if (!stored.startsWith(SAFE_PREFIX))
        return stored;
    try {
        const plain = electron_1.ipcRenderer.sendSync('secret:decrypt', stored.slice(SAFE_PREFIX.length));
        return plain ?? '';
    }
    catch {
        return '';
    }
}
// Never lose the last change if the window closes before the debounce fires.
window.addEventListener('pagehide', () => {
    if (_prefsTimer) {
        clearTimeout(_prefsTimer);
        _prefsTimer = null;
    }
    flushPrefs();
});
// ── Recents (stored in userData/recents.json) ─────────────────────────────────
let _userData = null;
async function getUserData() {
    if (!_userData) {
        const env = await electron_1.ipcRenderer.invoke('app:env');
        _userData = env.userData;
    }
    return _userData;
}
async function loadRecents() {
    try {
        const dir = await getUserData();
        const text = await fs.readFile(path.join(dir, 'recents.json'), 'utf-8');
        return JSON.parse(text);
    }
    catch {
        return [];
    }
}
async function saveRecents(recents) {
    const dir = await getUserData();
    const p = path.join(dir, 'recents.json');
    const tmp = `${p}.tmp-${process.pid}`;
    try {
        await fs.writeFile(tmp, JSON.stringify(recents, null, 2), 'utf-8');
        await fs.rename(tmp, p);
    }
    catch (e) {
        await fs.unlink(tmp).catch(() => { });
        throw e;
    }
}
async function touchRecent(entry) {
    const recents = await loadRecents();
    const filtered = recents.filter(r => r.id !== entry.id);
    filtered.unshift({ ...entry, opened: Date.now() });
    await saveRecents(filtered.slice(0, 20));
}
async function removeRecent(id) {
    const recents = await loadRecents();
    await saveRecents(recents.filter(r => r.id !== id));
}
// ── API implementation ────────────────────────────────────────────────────────
const api = {
    project: {
        async create(opts) {
            let location = opts.location;
            // Open native directory picker if needed
            if (location === 'browser-pick' || location === 'node-pick') {
                const dir = await electron_1.ipcRenderer.invoke('dialog:saveDir', opts.title);
                if (!dir)
                    throw new DOMException('No folder selected.', 'AbortError');
                location = dir;
            }
            const project = await NodeProjectService_1.nodeProjectService.create({ ...opts, location });
            await touchRecent({
                id: project.id, title: project.title,
                location: project.settings.location,
                words: Object.values(project.docs).reduce((a, d) => a + (0, utils_1.wordCount)(d.content), 0),
                template: project.settings.template,
                accent: project.settings.accent,
            });
            return project;
        },
        async open(bundlePath) {
            const project = await NodeProjectService_1.nodeProjectService.open(bundlePath);
            await touchRecent({
                id: project.id, title: project.title,
                location: project.settings.location,
                words: Object.values(project.docs).reduce((a, d) => a + (0, utils_1.wordCount)(d.content), 0),
                template: project.settings.template,
                accent: project.settings.accent,
            });
            return project;
        },
        // Electron reopens recents by real path — no handle persistence needed.
        async openRecent(_id, location) {
            const project = await NodeProjectService_1.nodeProjectService.open(location);
            await touchRecent({
                id: project.id, title: project.title,
                location: project.settings.location,
                words: Object.values(project.docs).reduce((a, d) => a + (0, utils_1.wordCount)(d.content), 0),
                template: project.settings.template,
                accent: project.settings.accent,
            });
            return project;
        },
        recents: loadRecents,
        close: (id) => NodeProjectService_1.nodeProjectService.close(id),
        removeRecent: async (id) => removeRecent(id),
        showOpenDialog: async () => {
            // Returns the path to a .konbini bundle directory (the user selects the bundle dir)
            const result = await electron_1.ipcRenderer.invoke('dialog:openDir');
            return result;
        },
        showSaveDialog: async (name) => {
            const result = await electron_1.ipcRenderer.invoke('dialog:saveDir', name);
            return result;
        },
    },
    doc: {
        read: (pid, nid) => NodeProjectService_1.nodeProjectService.readDoc(pid, nid),
        write: (pid, nid, content) => NodeProjectService_1.nodeProjectService.writeDoc(pid, nid, content),
    },
    node: {
        mutate: (pid, op) => NodeProjectService_1.nodeProjectService.mutateNode(pid, op),
    },
    snapshot: {
        take: (pid, nid, title, kind) => NodeProjectService_1.nodeProjectService.takeSnapshot(pid, nid, title, kind),
        restore: (pid, nid, sid) => NodeProjectService_1.nodeProjectService.restoreSnapshot(pid, nid, sid),
        list: (pid, nid) => NodeProjectService_1.nodeProjectService.listSnapshots(pid, nid),
        delete: (pid, nid, sid) => NodeProjectService_1.nodeProjectService.deleteSnapshot(pid, nid, sid),
    },
    codex: {
        save: (pid, entries) => NodeProjectService_1.nodeProjectService.saveCodex(pid, entries),
    },
    settings: {
        save: (pid, patch) => NodeProjectService_1.nodeProjectService.saveSettings(pid, patch),
    },
    compile: {
        run: (pid, rid, ids, fmt) => NodeProjectService_1.nodeProjectService.compile(pid, rid, ids, fmt),
    },
    prefs: {
        get: (key) => {
            const p = loadPrefs();
            if (!Object.prototype.hasOwnProperty.call(p, key))
                return null;
            return isSecret(key) ? decryptSecret(p[key]) : p[key];
        },
        set: (key, value) => {
            loadPrefs()[key] = isSecret(key) ? encryptSecret(value) : value;
            schedulePrefsFlush();
        },
        remove: (key) => { delete loadPrefs()[key]; schedulePrefsFlush(); },
    },
    aux: {
        read: (pid, name) => NodeProjectService_1.nodeProjectService.readAux(pid, name),
        write: (pid, name, content) => NodeProjectService_1.nodeProjectService.writeAux(pid, name, content),
        remove: (pid, name) => NodeProjectService_1.nodeProjectService.removeAux(pid, name),
    },
    shell: {
        platform: process.platform,
        minimize: () => { electron_1.ipcRenderer.invoke('shell:minimize'); },
        maximize: () => { electron_1.ipcRenderer.invoke('shell:maximize'); },
        close: () => { electron_1.ipcRenderer.invoke('shell:close'); },
        isMaximized: () => electron_1.ipcRenderer.invoke('shell:isMaximized'),
        onMaximizeChange: (cb) => {
            const handler = (_e, maximized) => cb(maximized);
            electron_1.ipcRenderer.on('shell:maximized', handler);
            return () => { electron_1.ipcRenderer.removeListener('shell:maximized', handler); };
        },
        openExternal: (url) => { electron_1.ipcRenderer.invoke('shell:openExternal', url); },
    },
    oauth: {
        exchange: (input) => electron_1.ipcRenderer.invoke('oauth:exchange', input),
        refresh: (input) => electron_1.ipcRenderer.invoke('oauth:refresh', input),
        streamMessages: (input, handlers) => {
            let reqId = -1;
            let channel = '';
            const listener = (_e, msg) => {
                if (msg.type === 'chunk')
                    handlers.onChunk(msg.data ?? '');
                else if (msg.type === 'done') {
                    cleanup();
                    handlers.onDone();
                }
                else if (msg.type === 'aborted') {
                    cleanup();
                    handlers.onAbort ? handlers.onAbort() : handlers.onDone();
                }
                else if (msg.type === 'error') {
                    cleanup();
                    handlers.onError({ status: msg.status, body: msg.body });
                }
            };
            const cleanup = () => { if (channel)
                electron_1.ipcRenderer.removeListener(channel, listener); };
            // start (reserve id) → attach listener → go (begin streaming) so no chunk is missed.
            void (async () => {
                try {
                    reqId = await electron_1.ipcRenderer.invoke('oauth:messages:start', input);
                    channel = `oauth:messages:${reqId}`;
                    electron_1.ipcRenderer.on(channel, listener);
                    await electron_1.ipcRenderer.invoke('oauth:messages:go', reqId);
                }
                catch (e) {
                    handlers.onError({ body: e.message });
                }
            })();
            return { abort: () => { if (reqId >= 0)
                    electron_1.ipcRenderer.invoke('oauth:messages:abort', reqId); } };
        },
    },
};
electron_1.contextBridge.exposeInMainWorld('api', api);
