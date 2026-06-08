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
const NodeProjectService_1 = require("./NodeProjectService");
const utils_1 = require("../src/shared/utils");
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
    await fs.writeFile(path.join(dir, 'recents.json'), JSON.stringify(recents, null, 2), 'utf-8');
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
        get: (key) => { try {
            return localStorage.getItem(key);
        }
        catch {
            return null;
        } },
        set: (key, value) => { try {
            localStorage.setItem(key, value);
        }
        catch { /* noop */ } },
        remove: (key) => { try {
            localStorage.removeItem(key);
        }
        catch { /* noop */ } },
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
    },
};
electron_1.contextBridge.exposeInMainWorld('api', api);
