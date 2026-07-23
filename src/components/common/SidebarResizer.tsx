import React from 'react'

// A thin drag gutter on a sidebar's inner edge. Dragging updates the panel's
// width CSS var live and persists it, so widths survive reload. Place as a child
// of a position:relative panel; `edge` is which edge of that panel it sits on.
interface Props {
  edge: 'left' | 'right'  // 'right' = binder (grows rightward); 'left' = right rail (grows leftward)
  cssVar: string          // e.g. '--binder-w'
  prefKey: string         // e.g. 'pref:binderWidth'
  min: number
  max: number
  fallback: number
}

export default function SidebarResizer({ edge, cssVar, prefKey, min, max, fallback }: Props): React.ReactElement {
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const panel = (e.currentTarget as HTMLElement).parentElement
    const startWidth = panel ? panel.offsetWidth : fallback
    const startX = e.clientX
    const sign = edge === 'right' ? 1 : -1
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const move = (ev: PointerEvent) => {
      const w = Math.max(min, Math.min(max, startWidth + sign * (ev.clientX - startX)))
      document.documentElement.style.setProperty(cssVar, `${w}px`)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      const final = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim().replace('px', '')
      if (final) window.api.prefs.set(prefKey, final)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue(cssVar), 10) || fallback
    const step = (e.key === 'ArrowRight' ? 16 : -16) * (edge === 'right' ? 1 : -1)
    const w = Math.max(min, Math.min(max, cur + step))
    document.documentElement.style.setProperty(cssVar, `${w}px`)
    window.api.prefs.set(prefKey, String(w))
  }

  return (
    <div
      className={`resizer resizer-${edge}`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      role="separator"
      aria-orientation="vertical"
      tabIndex={0}
      title="Drag to resize"
    />
  )
}
