// electron/main.ts — Electron main process entry point.
//
// Dev mode:  loads http://localhost:5173 (Vite dev server)
// Prod mode: loads the built renderer at <app>/dist/index.html. The compiled
//            main lives at <app>/electron-dist/electron/main.js, so the path
//            climbs two levels up to reach the app-root dist/.

import { app, BrowserWindow, ipcMain, dialog, shell, IpcMainInvokeEvent } from 'electron'
import * as path from 'path'
import * as fs from 'fs'

const DEV = process.env.ELECTRON_DEV === '1' || !app.isPackaged

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 640,       // keeps the 560px launch card clear of the 32px drag strip
    frame: false,         // custom titlebar
    titleBarStyle: 'hidden',
    backgroundColor: '#1a1a1f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,     // preload needs Node.js
    },
  })

  // Surface a failed load instead of blanking silently (open devtools so the
  // error is visible in a packaged build).
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`Renderer failed to load (${code} ${desc}): ${url}`)
    win?.webContents.openDevTools()
  })

  if (DEV) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  // Push maximize state to the renderer so window controls stay in sync no matter
  // how the window was (un)maximized — button, OS shortcut, or titlebar double-click.
  win.on('maximize', () => win?.webContents.send('shell:maximized', true))
  win.on('unmaximize', () => win?.webContents.send('shell:maximized', false))

  win.on('closed', () => { win = null })
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── IPC: app environment ──────────────────────────────────────────────────────

ipcMain.handle('app:env', () => ({
  userData: app.getPath('userData'),
  platform: process.platform,
}))

// ── IPC: window controls (for custom titlebar) ────────────────────────────────

ipcMain.handle('shell:minimize', () => { win?.minimize() })
ipcMain.handle('shell:maximize', () => {
  if (win?.isMaximized()) win.unmaximize()
  else win?.maximize()
})
ipcMain.handle('shell:close', () => { win?.close() })
ipcMain.handle('shell:isMaximized', () => win?.isMaximized() ?? false)

// ── IPC: native dialogs ───────────────────────────────────────────────────────

ipcMain.handle('dialog:openDir', async (event: IpcMainInvokeEvent) => {
  const w = BrowserWindow.fromWebContents(event.sender) ?? win
  if (!w) return null
  const result = await dialog.showOpenDialog(w, {
    title: 'Open Konbini Project',
    properties: ['openDirectory'],
    filters: [],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:saveDir', async (event: IpcMainInvokeEvent, _defaultName: string) => {
  const w = BrowserWindow.fromWebContents(event.sender) ?? win
  if (!w) return null
  const result = await dialog.showOpenDialog(w, {
    title: 'Choose a folder for your new project',
    properties: ['openDirectory', 'createDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
})

// ── IPC: file system operations (proxied from preload) ────────────────────────
// For security, the preload runs with Node access in its own context.
// These handlers allow main to do privileged ops if needed in future.

ipcMain.handle('shell:openExternal', async (_e: IpcMainInvokeEvent, url: string) => {
  await shell.openExternal(url)
})
