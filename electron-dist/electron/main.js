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
// Linux packaged builds — the AppImage most of all — routinely open to a black
// window. The renderer HTML loads fine (so did-fail-load never fires), but the
// Chromium GPU process can't initialize under the host's driver (llvmpipe / VMs)
// or the SUID sandbox is blocked by the distro's unprivileged-user-namespace
// lockdown (Ubuntu 23.10+, 24.04). Either way compositing silently fails and
// the window shows only its backgroundColor. Disabling hardware acceleration
// and the GPU/SUID sandbox keeps the renderer painting. Linux-only; macOS and
// Windows are untouched. Allow an escape hatch for users who want the GPU path.
if (process.platform === 'linux' && process.env.KONBINI_ENABLE_GPU !== '1') {
    electron_1.app.disableHardwareAcceleration();
    electron_1.app.commandLine.appendSwitch('no-sandbox');
    electron_1.app.commandLine.appendSwitch('disable-gpu-sandbox');
}
let win = null;
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
    // Surface a failed load instead of blanking silently (open devtools so the
    // error is visible in a packaged build).
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
        console.error(`Renderer failed to load (${code} ${desc}): ${url}`);
        win?.webContents.openDevTools();
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
