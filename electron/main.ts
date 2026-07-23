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

// Linux packaged builds — the AppImage most of all — routinely open to a black
// window. The renderer HTML loads fine (so did-fail-load never fires), but the
// Chromium GPU process can't initialize under the host's driver (llvmpipe / VMs)
// or the SUID sandbox is blocked by the distro's unprivileged-user-namespace
// lockdown (Ubuntu 23.10+, 24.04). Either way compositing silently fails and
// the window shows only its backgroundColor. Disabling hardware acceleration
// and the GPU/SUID sandbox keeps the renderer painting. Linux-only; macOS and
// Windows are untouched. Allow an escape hatch for users who want the GPU path.
if (process.platform === 'linux' && process.env.KONBINI_ENABLE_GPU !== '1') {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}

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

  // A crashed/killed renderer paints nothing but the window backgroundColor —
  // the other way a "black screen" happens. Log it loudly so a packaged build
  // isn't a silent void, and pop devtools to make the reason inspectable.
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`Renderer process gone: ${details.reason} (exit ${details.exitCode})`)
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

// ── IPC: Claude OAuth token endpoint ──────────────────────────────────────────
// The token endpoint sends no CORS headers, so the renderer can't call it from a
// file:// origin. Main proxies the exchange/refresh with Node's fetch (no CORS).

const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token'

interface OAuthTokenResult {
  ok: boolean
  accessToken?: string
  refreshToken?: string
  expiresIn?: number
  error?: string
}

async function postToken(payload: Record<string, string>): Promise<OAuthTokenResult> {
  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({} as Record<string, unknown>))
    if (!res.ok) {
      const err = (data as { error_description?: string; error?: string })
      return { ok: false, error: err.error_description ?? err.error ?? `HTTP ${res.status}` }
    }
    const d = data as { access_token?: string; refresh_token?: string; expires_in?: number }
    return { ok: true, accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: d.expires_in }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

ipcMain.handle('oauth:exchange', (_e: IpcMainInvokeEvent, input: { code: string; state: string; verifier: string; redirectUri: string }) =>
  postToken({
    grant_type: 'authorization_code',
    code: input.code,
    state: input.state,
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
  }),
)

ipcMain.handle('oauth:refresh', (_e: IpcMainInvokeEvent, input: { refreshToken: string }) =>
  postToken({
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: OAUTH_CLIENT_ID,
  }),
)
