import React, { useEffect, useRef } from 'react'

export interface MenuItem {
  label: string
  action?: () => void
  danger?: boolean
  disabled?: boolean
  /** Renders as a non-interactive section label instead of a button. */
  header?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

// Shared right-click menu. Surfaces (binder, corkboard, outliner, version
// lists) supply their own MenuItem[]; this handles positioning, outside-click
// dismissal, separators ('---'), and disabled/danger styling.
export default function ContextMenu({ x, y, items, onClose }: Props): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Adjust position so the menu doesn't run off-screen.
  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - items.length * 34 - 20),
  }

  return (
    <div ref={ref} className="ctx" style={style}>
      {items.map((item, i) =>
        item.label === '---' ? (
          <hr key={i} />
        ) : item.header ? (
          <div key={i} className="ctx-head">{item.label}</div>
        ) : (
          <button
            key={i}
            className={item.danger ? 'danger' : ''}
            onClick={() => { item.action?.(); onClose() }}
            disabled={item.disabled}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  )
}
