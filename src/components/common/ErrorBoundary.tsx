import React from 'react'

interface Props { children: React.ReactNode }
interface State { error: Error | null }

// Root error boundary: a render error in any component would otherwise blank the
// whole app (the classic "black screen"). Catch it and show a recoverable panel
// instead. Work autosaves continuously, so reloading is safe.
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Konbini render error:', error, info.componentStack)
  }

  render(): React.ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div style={{
        position: 'fixed', inset: 0, display: 'grid', placeItems: 'center',
        background: 'var(--bg, #1a1a1f)', color: 'var(--text, #e6e6ea)', padding: 24,
        font: '14px/1.6 system-ui, sans-serif', zIndex: 99999,
      }}>
        <div style={{ maxWidth: 520, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✦</div>
          <h2 style={{ margin: '0 0 8px' }}>Something broke on screen</h2>
          <p style={{ color: 'var(--text-3, #a0a0aa)', margin: '0 0 16px' }}>
            The interface hit an error. Your work is saved to disk — reloading is safe.
          </p>
          <pre style={{
            textAlign: 'left', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            background: 'var(--bg-2, #26262e)', padding: '10px 12px', borderRadius: 'var(--r-md)',
            fontSize: 12, maxHeight: 160, overflow: 'auto', margin: '0 0 16px',
          }}>{error.message}</pre>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              onClick={() => this.setState({ error: null })}
              style={{ padding: '7px 14px', borderRadius: 'var(--r-md)', border: '1px solid var(--border-2, #3a3a44)', background: 'transparent', color: 'inherit', cursor: 'pointer' }}
            >
              Try to recover
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{ padding: '7px 14px', borderRadius: 'var(--r-md)', border: 'none', background: 'var(--accent, #7a5cff)', color: 'var(--accent-fg, #fff)', cursor: 'pointer' }}
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
