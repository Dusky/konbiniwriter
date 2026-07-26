import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { runQuery } from '@shared/query'
import type { ID, Project } from '@shared/types'
import Icon from '../common/Icon'

/** "Part One › Chapter 3" — where a document lives, without its own title. */
function pathOf(project: Project, id: ID): string {
  const parts: string[] = []
  let cur = project.nodes[id]?.parentId ?? null
  while (cur) {
    const n = project.nodes[cur]
    if (!n) break
    parts.unshift(n.title)
    cur = n.parentId
  }
  return parts.join(' › ')
}

interface Props {
  /** The document this pane is currently showing. */
  value: ID | null
  onPick: (id: ID) => void
  /** Shown on the trigger when nothing is selected. */
  placeholder?: string
}

/**
 * Document picker for a split pane.
 *
 * A flat `<select>` of every document is fine at twenty scenes and useless at
 * two hundred: no order, no hierarchy, and no way to find anything except
 * scrolling. This lists documents in *binder order* with the folder path they
 * live under, and filters as you type — so "ch9" or "graveyard" gets you there
 * regardless of how deep it's buried.
 */
export default function DocPicker({ value, onPick, placeholder = 'Pick a document' }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Documents only, in binder order, Trash excluded — runQuery walks the tree.
  const docs = useMemo(() => {
    if (!project) return []
    return runQuery(project, { types: ['document', 'scene'] })
      .map((id) => ({ id, title: project.nodes[id].title, path: pathOf(project, id) }))
  }, [project])

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return docs
    return docs.filter((d) =>
      d.title.toLowerCase().includes(needle) || d.path.toLowerCase().includes(needle))
  }, [docs, q])

  useEffect(() => { setActive(0) }, [q])

  // Reopening starts fresh. Keeping the last filter means a search that found
  // nothing leaves the picker looking empty and broken the next time it opens.
  useEffect(() => {
    if (!open) return
    setQ('')
    setActive(0)
    inputRef.current?.focus()
  }, [open])

  // Close on an outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Keep the keyboard-selected row in view.
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector('.dp-item.on')?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const choose = (id: ID) => { onPick(id); setOpen(false); setQ('') }

  const current = project && value ? project.nodes[value] : null

  return (
    <div className="dp" ref={rootRef}>
      <button
        className="dp-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={current ? `${pathOf(project!, current.id)} › ${current.title}` : placeholder}
      >
        <Icon name="document" size={12} />
        <span className="dp-trigger-t">{current?.title ?? placeholder}</span>
        <Icon name="chevron-down" size={12} />
      </button>

      {open && (
        <div className="dp-pop">
          <input
            ref={inputRef}
            className="dp-search"
            value={q}
            placeholder="Filter documents…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); if (results[active]) choose(results[active].id) }
              else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
            }}
          />
          <div className="dp-list" ref={listRef} role="listbox">
            {results.length === 0 ? (
              <div className="dp-empty">No documents match “{q}”.</div>
            ) : results.map((d, i) => (
              <button
                key={d.id}
                role="option"
                aria-selected={d.id === value}
                className={`dp-item${i === active ? ' on' : ''}${d.id === value ? ' cur' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(d.id)}
              >
                <span className="dp-title">{d.title}</span>
                {d.path && <span className="dp-path">{d.path}</span>}
              </button>
            ))}
          </div>
          <div className="dp-foot">{results.length} of {docs.length} · or drag one in from the binder</div>
        </div>
      )}
    </div>
  )
}
