import React, { useEffect } from 'react'
import { useShellStore } from '../../store/shellStore'

export default function Toast(): React.ReactElement | null {
  const toast = useShellStore((s) => s.toast)
  const clearToast = useShellStore((s) => s.clearToast)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(clearToast, 5000)
    return () => clearTimeout(t)
  }, [toast?.id])

  if (!toast) return null

  const borderColor =
    toast.type === 'error' ? 'var(--st-idea)'
    : toast.type === 'success' ? 'var(--st-final)'
    : 'var(--accent)'

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: 'fixed', bottom: 48, left: '50%', transform: 'translateX(-50%)',
        background: 'var(--bg-3)', border: `1px solid ${borderColor}`,
        borderRadius: 8, padding: '10px 16px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
        zIndex: 9999, display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 13, color: 'var(--text)', maxWidth: 480, minWidth: 240,
        animation: 'toast-in 0.15s ease',
      }}
    >
      <span style={{ color: borderColor, fontSize: 15, lineHeight: 1 }}>
        {toast.type === 'error' ? '⚠' : toast.type === 'success' ? '✓' : 'ℹ'}
      </span>
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button
        onClick={clearToast}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 0, fontSize: 14, lineHeight: 1 }}
        aria-label="Dismiss"
      >✕</button>
    </div>
  )
}
