import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon, { type IconName } from './Icon'

export interface MenuItem {
  label: string
  action?: () => void
  danger?: boolean
  disabled?: boolean
  /** Renders as a non-interactive section label instead of a button. */
  header?: boolean
  /** Leading glyph. */
  icon?: IconName
  /** Trailing shortcut hint, e.g. kbd('mod+shift+s'). */
  hint?: string
  /** Shows a checkmark. Use for toggles and for "current value" in a submenu. */
  checked?: boolean
  /** A nested menu. An item with children ignores `action`. */
  items?: MenuItem[]
}

const isSeparator = (i: MenuItem) => i.label === '---'
const isSelectable = (i: MenuItem) => !isSeparator(i) && !i.header && !i.disabled

interface LevelProps {
  items: MenuItem[]
  onClose: () => void
  /** Root menus position themselves at the pointer; submenus beside their parent. */
  anchor: { x: number; y: number } | 'submenu'
  /** Escape/ArrowLeft in a submenu hands focus back up. */
  onDismissLevel?: () => void
}

function MenuLevel({ items, onClose, anchor, onDismissLevel }: LevelProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(() => items.findIndex(isSelectable))
  const [openSub, setOpenSub] = useState<number | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(
    anchor === 'submenu' ? null : { left: anchor.x, top: anchor.y },
  )
  const typeahead = useRef({ buf: '', at: 0 })

  // Measure before paint, then clamp inside the viewport — flipping to the
  // other side of the pointer rather than sliding, so the menu never covers
  // the thing that was right-clicked.
  useLayoutEffect(() => {
    if (anchor === 'submenu' || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const pad = 8
    let left = anchor.x
    let top = anchor.y
    if (left + r.width > window.innerWidth - pad) left = Math.max(pad, anchor.x - r.width)
    if (top + r.height > window.innerHeight - pad) top = Math.max(pad, anchor.y - r.height)
    setPos({ left, top })
  }, [anchor])

  // The menu takes focus so arrow keys work without the caller wiring anything.
  useEffect(() => { ref.current?.focus() }, [])

  const move = useCallback((dir: 1 | -1) => {
    setActive((cur) => {
      const n = items.length
      for (let step = 1; step <= n; step++) {
        const i = (cur + dir * step + n * step) % n
        if (isSelectable(items[i])) return i
      }
      return cur
    })
    setOpenSub(null)
  }, [items])

  const run = useCallback((i: number) => {
    const item = items[i]
    if (!item || !isSelectable(item)) return
    if (item.items?.length) { setOpenSub(i); return }
    item.action?.()
    onClose()
  }, [items, onClose])

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); break
      case 'ArrowUp': e.preventDefault(); move(-1); break
      case 'Home': e.preventDefault(); setActive(items.findIndex(isSelectable)); break
      case 'End': {
        e.preventDefault()
        for (let i = items.length - 1; i >= 0; i--) if (isSelectable(items[i])) { setActive(i); break }
        break
      }
      case 'ArrowRight':
        if (items[active]?.items?.length) { e.preventDefault(); setOpenSub(active) }
        break
      case 'ArrowLeft':
        if (onDismissLevel) { e.preventDefault(); onDismissLevel() }
        break
      case 'Enter':
      case ' ':
        e.preventDefault(); run(active); break
      case 'Escape':
        e.preventDefault()
        ;(onDismissLevel ?? onClose)()
        break
      default: {
        // Type-ahead: jump to the next item starting with what was typed.
        if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return
        const now = Date.now()
        const t = typeahead.current
        t.buf = now - t.at > 600 ? e.key : t.buf + e.key
        t.at = now
        const q = t.buf.toLowerCase()
        const from = t.buf.length === 1 ? active + 1 : active
        for (let step = 0; step < items.length; step++) {
          const i = (from + step) % items.length
          if (isSelectable(items[i]) && items[i].label.toLowerCase().startsWith(q)) { setActive(i); break }
        }
      }
    }
  }

  const style: React.CSSProperties = anchor === 'submenu'
    ? {}
    : { left: pos?.left ?? anchor.x, top: pos?.top ?? anchor.y, visibility: pos ? 'visible' : 'hidden' }

  return (
    <div
      ref={ref}
      className={`ctx${anchor === 'submenu' ? ' ctx-sub' : ''}`}
      style={style}
      role="menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {items.map((item, i) =>
        isSeparator(item) ? (
          <hr key={i} />
        ) : item.header ? (
          <div key={i} className="ctx-head" role="presentation">{item.label}</div>
        ) : (
          <div key={i} className="ctx-row">
            <button
              role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={item.checked === undefined ? undefined : item.checked}
              aria-haspopup={item.items?.length ? 'menu' : undefined}
              aria-expanded={item.items?.length ? openSub === i : undefined}
              className={`${item.danger ? 'danger ' : ''}${active === i ? 'active' : ''}`}
              onClick={() => run(i)}
              onMouseEnter={() => {
                if (!isSelectable(item)) return
                setActive(i)
                setOpenSub(item.items?.length ? i : null)
              }}
              disabled={item.disabled}
            >
              <span className="ctx-check">{item.checked ? <Icon name="check" size={12} /> : null}</span>
              {item.icon && <Icon name={item.icon} size={13} />}
              <span className="ctx-label">{item.label}</span>
              {item.hint && <span className="ctx-hint">{item.hint}</span>}
              {item.items?.length ? <Icon name="chevron" size={12} /> : null}
            </button>

            {openSub === i && item.items?.length ? (
              <MenuLevel
                items={item.items}
                onClose={onClose}
                anchor="submenu"
                onDismissLevel={() => { setOpenSub(null); ref.current?.focus() }}
              />
            ) : null}
          </div>
        ),
      )}
    </div>
  )
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

/**
 * Shared right-click menu.
 *
 * Surfaces supply a `MenuItem[]`; this handles positioning, dismissal,
 * separators (`'---'`), headers, icons, shortcut hints, checkable items,
 * submenus, and full keyboard navigation — arrows, Home/End, Enter, Escape,
 * and type-ahead. A menu you can only reach with the mouse is a menu a
 * keyboard-first app can't really claim to have.
 */
export default function ContextMenu({ x, y, items, onClose }: Props): React.ReactElement {
  const wrapRef = useRef<HTMLDivElement>(null)
  // Focus returns where it came from, so right-clicking in the editor and
  // pressing Escape leaves the caret where the writer left it.
  const restoreRef = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onClose()
    }
    // Registered on the next tick, not now. React flushes discrete events
    // synchronously, so this effect runs while the very right-click that opened
    // the menu is still bubbling toward document — listening immediately means
    // the menu dismisses itself the instant it appears.
    const arm = setTimeout(() => {
      // A right-click elsewhere should move the menu, not leave two open.
      document.addEventListener('mousedown', onDown)
      document.addEventListener('contextmenu', onDown)
      window.addEventListener('blur', onClose)
    }, 0)
    return () => {
      clearTimeout(arm)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('contextmenu', onDown)
      window.removeEventListener('blur', onClose)
      const el = restoreRef.current
      if (el instanceof HTMLElement && document.contains(el)) el.focus()
    }
  }, [onClose])

  // Portalled to <body>. `.ctx` is `position: fixed` with a high z-index, but
  // z-index only orders siblings *within a stacking context* — rendered inside
  // the right rail, the menu sat below the rail's own resize handle, and the
  // items under it silently could not be clicked. Escaping to the body root
  // means a menu is never trapped by whatever panel opened it.
  return createPortal(
    <div ref={wrapRef}>
      <MenuLevel items={items} onClose={onClose} anchor={{ x, y }} />
    </div>,
    document.body,
  )
}
