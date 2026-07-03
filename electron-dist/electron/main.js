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
