import React, { useEffect, useState } from 'react'

// Native window controls for the frameless Electron window. Wired to the
// window.api.shell IPC bridge. Hidden in the browser (no window chrome) and on
// macOS (the native traffic lights remain under titleBarStyle: 'hidden').
const isElectron = typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent)

export default function WindowControls(): React.ReactElement | null {
  const shell = window.api?.shell
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    shell?.isMaximized?.().then(setMaximized).catch(() => {})
  }, [shell])

  if (!isElectron || !shell || shell.platform === 'darwin') return null

  const onMax = () => {
    shell.maximize()
    setMaximized((m) => !m)
  }

  return (
    <div className="win-controls">
      <button className="wc" title="Minimize" aria-label="Minimize" onClick={() => shell.minimize()}>
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 5h8" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
      <button className="wc" title={maximized ? 'Restore' : 'Maximize'} aria-label="Maximize" onClick={onMax}>
        {maximized
          ? <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2.5 3.5h4v4h-4z M3.5 3.5V2.5h4v4h-1" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
          : <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" /></svg>}
      </button>
      <button className="wc close" title="Close window" aria-label="Close window" onClick={() => shell.close()}>
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
    </div>
  )
}
