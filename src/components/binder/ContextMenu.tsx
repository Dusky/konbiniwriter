import React, { useEffect, useRef } from 'react'

export interface MenuItem {
  label: string
  action: () => void
  danger?: boolean
  disabled?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: Props): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Adjust position so menu doesn't go off-screen
  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - items.length * 34 - 20),
  }

  return (
    <div ref={ref} className="ctx" style={style}>
      {items.map((item, i) =>
        item.label === '---' ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            className={item.danger ? 'danger' : ''}
            onClick={() => { item.action(); onClose() }}
            disabled={item.disabled}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  )
}
