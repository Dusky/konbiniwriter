"use strict";
// electron/main.ts — Electron main process entry point.
//
// Dev mode:  loads http://localhost:5173 (Vite dev server)
// Prod mode: loads the built renderer at <app>/dist/index.html. The compiled
//            main lives at <app>/electron-dist/electron/main.js, so the path
//            climbs two levels up to reach the app-root dist/.
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
const DEV = process.env.ELECTRON_DEV === '1' || !electron_1.app.isPackaged;
// Linux routinely opens Electron to a black window — in the packaged AppImage
// and in constrained dev/container environments alike. Two independent causes,
// so two independent guards (macOS and Windows are untouched):
if (process.platform === 'linux') {
    // (1) Shared memory + sandbox. A missing/too-small /dev/shm (containers,
    // sandboxed desktops) makes Chromium's shm allocation fatal — fall back to a
    // temp dir. And the SUID sandbox is blocked by many distros' unprivileged-
    // user-namespace lockdown (Ubuntu 23.10+, 24.04), which crashes the renderer.
    // These aren't GPU-related, so they always apply.
    electron_1.app.commandLine.appendSwitch('disable-dev-shm-usage');
    electron_1.app.commandLine.appendSwitch('no-sandbox');
    // (2) GPU compositing. When the GPU process can't initialize under the host's
    // driver (llvmpipe / VMs) the window paints only its backgroundColor — the
    // renderer HTML loads, so did-fail-load never fires. Disabling hardware
    // acceleration and the GPU sandbox keeps it painting. Escape hatch for users
    // who want the GPU path: KONBINI_ENABLE_GPU=1.
    if (process.env.KONBINI_ENABLE_GPU !== '1') {
        electron_1.app.disableHardwareAcceleration();
        electron_1.app.commandLine.appendSwitch('disable-gpu-sandbox');
    }
}
let win = null;
// Shown in dev when http://localhost:5173 refuses the connection — i.e. the
// Vite server isn't up yet. electron:dev only compiles + launches Electron.
const DEV_SERVER_DOWN_PAGE = 'data:text/html,' +
    encodeURIComponent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:#1a1a1f;color:#e6e6ea;font:15px/1.6 system-ui,sans-serif">
      <div style="max-width:34rem;padding:2rem;text-align:center">
        <h2 style="margin:0 0 .5rem">Vite dev server isn't running</h2>
        <p style="color:#a0a0aa;margin:0 0 1rem">The desktop shell loaded, but nothing is serving <code>http://localhost:5173</code>.</p>
        <p style="margin:0">Start it in a separate terminal, then relaunch:</p>
        <pre style="background:#26262e;padding:.75rem 1rem;border-radius:8px;display:inline-block;margin:.75rem 0 0">npm run dev</pre>
      </div>
    </body>`);
function createWindow() {
    win = new electron_1.BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 640, // keeps the 560px launch card clear of the 32px drag strip
        frame: false, // custom titlebar
        titleBarStyle: 'hidden',
        backgroundColor: '#1a1a1f',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false, // preload needs Node.js
        },
    });
    // Surface a failed load instead of blanking silently. In dev, a refused
    // connection almost always means the Vite server isn't running (electron:dev
    // does not start it) — show that as a page rather than a black void. In a
    // packaged build, pop devtools so the error is at least inspectable.
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
        console.error(`Renderer failed to load (${code} ${desc}): ${url}`);
        if (DEV && url.startsWith('http://localhost:5173')) {
            win?.loadURL(DEV_SERVER_DOWN_PAGE);
        }
        else {
            win?.webContents.openDevTools();
        }
    });
    // A crashed/killed renderer paints nothing but the window backgroundColor —
    // the other way a "black screen" happens. Log it loudly so a packaged build
    // isn't a silent void, and pop devtools to make the reason inspectable.
    win.webContents.on('render-process-gone', (_e, details) => {
        console.error(`Renderer process gone: ${details.reason} (exit ${details.exitCode})`);
        win?.webContents.openDevTools();
    });
    if (DEV) {
        win.loadURL('http://localhost:5173');
        win.webContents.openDevTools();
    }
    else {
        win.loadFile(path.join(__dirname, '../../dist/index.html'));
    }
    // Push maximize state to the renderer so window controls stay in sync no matter
    // how the window was (un)maximized — button, OS shortcut, or titlebar double-click.
    win.on('maximize', () => win?.webContents.send('shell:maximized', true));
    win.on('unmaximize', () => win?.webContents.send('shell:maximized', false));
    win.on('closed', () => { win = null; });
}
electron_1.app.whenReady().then(() => {
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
// ── IPC: app environment ──────────────────────────────────────────────────────
electron_1.ipcMain.handle('app:env', () => ({
    userData: electron_1.app.getPath('userData'),
    platform: process.platform,
}));
// Synchronous userData path — the preload needs it before the renderer's stores
// hydrate their prefs at construction time.
electron_1.ipcMain.on('app:userDataSync', (e) => { e.returnValue = electron_1.app.getPath('userData'); });
// ── IPC: window controls (for custom titlebar) ────────────────────────────────
electron_1.ipcMain.handle('shell:minimize', () => { win?.minimize(); });
electron_1.ipcMain.handle('shell:maximize', () => {
    if (win?.isMaximized())
        win.unmaximize();
    else
        win?.maximize();
});
electron_1.ipcMain.handle('shell:close', () => { win?.close(); });
electron_1.ipcMain.handle('shell:isMaximized', () => win?.isMaximized() ?? false);
// ── IPC: native dialogs ───────────────────────────────────────────────────────
electron_1.ipcMain.handle('dialog:openDir', async (event) => {
    const w = electron_1.BrowserWindow.fromWebContents(event.sender) ?? win;
    if (!w)
        return null;
    const result = await electron_1.dialog.showOpenDialog(w, {
        title: 'Open Konbini Project',
        properties: ['openDirectory'],
        filters: [],
    });
    return result.canceled ? null : result.filePaths[0];
});
electron_1.ipcMain.handle('dialog:saveDir', async (event, _defaultName) => {
    const w = electron_1.BrowserWindow.fromWebContents(event.sender) ?? win;
    if (!w)
        return null;
    const result = await electron_1.dialog.showOpenDialog(w, {
        title: 'Choose a folder for your new project',
        properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
});
// ── IPC: file system operations (proxied from preload) ────────────────────────
// For security, the preload runs with Node access in its own context.
// These handlers allow main to do privileged ops if needed in future.
electron_1.ipcMain.handle('shell:openExternal', async (_e, url) => {
    await electron_1.shell.openExternal(url);
});
// ── IPC: Claude OAuth token endpoint ──────────────────────────────────────────
// The token endpoint sends no CORS headers, so the renderer can't call it from a
// file:// origin. Main proxies the exchange/refresh with Node's fetch (no CORS).
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
async function postToken(payload) {
    try {
        const res = await fetch(OAUTH_TOKEN_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(payload),
        });
        const text = await res.text();
        let data = {};
        try {
            data = JSON.parse(text);
        }
        catch { /* non-JSON error body */ }
        if (!res.ok) {
            const err = data;
            const detail = [err.error, err.error_description].filter(Boolean).join(': ');
            return { ok: false, error: `${detail || text.slice(0, 200) || 'request failed'} (HTTP ${res.status})` };
        }
        const d = data;
        return { ok: true, accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: d.expires_in };
    }
    catch (e) {
        return { ok: false, error: e.message };
    }
}
electron_1.ipcMain.handle('oauth:exchange', (_e, input) => postToken({
    grant_type: 'authorization_code',
    code: input.code,
    state: input.state,
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
}));
electron_1.ipcMain.handle('oauth:refresh', (_e, input) => postToken({
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: OAUTH_CLIENT_ID,
}));
// ── IPC: OAuth (subscription) Messages API streaming ──────────────────────────
// Subscription tokens are rejected when the request carries a browser Origin, so
// the inference call is proxied here (Node fetch, no browser headers). A
// start→go handshake lets the renderer attach its listener before bytes flow, so
// no early SSE chunk is lost. Chunks are forwarded raw; the renderer parses SSE.
const OAUTH_BETA = 'oauth-2025-04-20';
let _oauthSeq = 0;
const _oauthPending = new Map();
electron_1.ipcMain.handle('oauth:messages:start', (event, payload) => {
    const id = ++_oauthSeq;
    _oauthPending.set(id, { token: payload.token, body: payload.body, sender: event.sender, controller: new AbortController() });
    return id;
});
electron_1.ipcMain.handle('oauth:messages:abort', (_e, id) => {
    _oauthPending.get(id)?.controller.abort();
});
electron_1.ipcMain.handle('oauth:messages:go', async (_e, id) => {
    const req = _oauthPending.get(id);
    if (!req)
        return;
    const channel = `oauth:messages:${id}`;
    const send = (msg) => { if (!req.sender.isDestroyed())
        req.sender.send(channel, msg); };
    try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'authorization': `Bearer ${req.token}`,
                'anthropic-version': '2023-06-01',
                'anthropic-beta': OAUTH_BETA,
                'content-type': 'application/json',
                'user-agent': 'Konbini/0.1',
            },
            body: JSON.stringify(req.body),
            signal: req.controller.signal,
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            send({ type: 'error', status: res.status, body: text });
            return;
        }
        const reader = res.body?.getReader();
        if (!reader) {
            send({ type: 'error', status: 0, body: 'No response body' });
            return;
        }
        const decoder = new TextDecoder();
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            send({ type: 'chunk', data: decoder.decode(value, { stream: true }) });
        }
        const tail = decoder.decode();
        if (tail)
            send({ type: 'chunk', data: tail });
        send({ type: 'done' });
    }
    catch (e) {
        if (e.name === 'AbortError')
            send({ type: 'aborted' });
        else
            send({ type: 'error', status: 0, body: e.message });
    }
    finally {
        _oauthPending.delete(id);
    }
});
