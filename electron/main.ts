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

// Linux routinely opens Electron to a black window — in the packaged AppImage
// and in constrained dev/container environments alike. Two independent causes,
// so two independent guards (macOS and Windows are untouched):
if (process.platform === 'linux') {
  // (1) Shared memory + sandbox. A missing/too-small /dev/shm (containers,
  // sandboxed desktops) makes Chromium's shm allocation fatal — fall back to a
  // temp dir. And the SUID sandbox is blocked by many distros' unprivileged-
  // user-namespace lockdown (Ubuntu 23.10+, 24.04), which crashes the renderer.
  // These aren't GPU-related, so they always apply.
  app.commandLine.appendSwitch('disable-dev-shm-usage')
  app.commandLine.appendSwitch('no-sandbox')

  // (2) GPU compositing. When the GPU process can't initialize under the host's
  // driver (llvmpipe / VMs) the window paints only its backgroundColor — the
  // renderer HTML loads, so did-fail-load never fires. Disabling hardware
  // acceleration and the GPU sandbox keeps it painting. Escape hatch for users
  // who want the GPU path: KONBINI_ENABLE_GPU=1.
  if (process.env.KONBINI_ENABLE_GPU !== '1') {
    app.disableHardwareAcceleration()
    app.commandLine.appendSwitch('disable-gpu-sandbox')
  }
}

let win: BrowserWindow | null = null

// Shown in dev when http://localhost:5173 refuses the connection — i.e. the
// Vite server isn't up yet. electron:dev only compiles + launches Electron.
const DEV_SERVER_DOWN_PAGE =
  'data:text/html,' +
  encodeURIComponent(
    `<body style="margin:0;height:100vh;display:grid;place-items:center;background:#1a1a1f;color:#e6e6ea;font:15px/1.6 system-ui,sans-serif">
      <div style="max-width:34rem;padding:2rem;text-align:center">
        <h2 style="margin:0 0 .5rem">Vite dev server isn't running</h2>
        <p style="color:#a0a0aa;margin:0 0 1rem">The desktop shell loaded, but nothing is serving <code>http://localhost:5173</code>.</p>
        <p style="margin:0">Start it in a separate terminal, then relaunch:</p>
        <pre style="background:#26262e;padding:.75rem 1rem;border-radius:8px;display:inline-block;margin:.75rem 0 0">npm run dev</pre>
      </div>
    </body>`,
  )

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

  // Surface a failed load instead of blanking silently. In dev, a refused
  // connection almost always means the Vite server isn't running (electron:dev
  // does not start it) — show that as a page rather than a black void. In a
  // packaged build, pop devtools so the error is at least inspectable.
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`Renderer failed to load (${code} ${desc}): ${url}`)
    if (DEV && url.startsWith('http://localhost:5173')) {
      win?.loadURL(DEV_SERVER_DOWN_PAGE)
    } else {
      win?.webContents.openDevTools()
    }
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
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    })
    const text = await res.text()
    let data: Record<string, unknown> = {}
    try { data = JSON.parse(text) } catch { /* non-JSON error body */ }
    if (!res.ok) {
      const err = data as { error_description?: string; error?: string }
      const detail = [err.error, err.error_description].filter(Boolean).join(': ')
      return { ok: false, error: `${detail || text.slice(0, 200) || 'request failed'} (HTTP ${res.status})` }
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
