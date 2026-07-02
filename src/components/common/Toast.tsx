import React, { useEffect } from 'react'
import { useShellStore, type Toast as ToastItem } from '../../store/shellStore'

function ToastCard({ toast }: { toast: ToastItem }): React.ReactElement {
  const clearToast = useShellStore((s) => s.clearToast)

  useEffect(() => {
    const t = setTimeout(() => clearToast(toast.id), 5000)
    return () => clearTimeout(t)
  }, [toast.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const borderColor =
    toast.type === 'error' ? 'var(--st-idea)'
    : toast.type === 'success' ? 'var(--st-final)'
    : 'var(--accent)'

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        background: 'var(--bg-3)', border: `1px solid ${borderColor}`,
        borderRadius: 8, padding: '10px 16px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
        display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 13, color: 'var(--text)', maxWidth: 480, minWidth: 240,
        animation: 'toast-in 0.15s ease',
      }}
    >
      <span style={{ color: borderColor, fontSize: 15, lineHeight: 1 }}>
        {toast.type === 'error' ? '⚠' : toast.type === 'success' ? '✓' : 'ℹ'}
      </span>
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button
        onClick={() => clearToast(toast.id)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 0, fontSize: 14, lineHeight: 1 }}
        aria-label="Dismiss"
      >✕</button>
    </div>
  )
}

export default function Toast(): React.ReactElement | null {
  const toasts = useShellStore((s) => s.toasts)
  if (toasts.length === 0) return null

  return (
    <div style={{
      position: 'fixed', bottom: 48, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center',
    }}>
      {toasts.map((t) => <ToastCard key={t.id} toast={t} />)}
    </div>
  )
}
