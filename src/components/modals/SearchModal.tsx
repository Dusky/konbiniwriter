import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useProjectStore } from '../../store/projectStore'
import type { ID } from '@shared/types'

const MAX_PER_DOC = 6
const MAX_DOCS = 40

interface DocHit {
  nodeId: ID
  title: string
  titleMatch: boolean
  total: number          // total matches in body (may exceed shown)
  matches: Array<{ offset: number; pre: string; mid: string; post: string }>
}

// Flattened selectable row: a doc header (offset = first match or 0) or a match.
interface FlatRow { nodeId: ID; offset: number; len: number }

function excerptParts(content: string, at: number, len: number) {
  const start = Math.max(0, at - 36)
  const end = Math.min(content.length, at + len + 56)
  const clean = (s: string) => s.replace(/\s+/g, ' ')
  return {
    offset: at,
    pre: (start > 0 ? '…' : '') + clean(content.slice(start, at)),
    mid: content.slice(at, at + len),
    post: clean(content.slice(at + len, end)) + (end < content.length ? '…' : ''),
  }
}

interface Props { onClose: () => void }

export default function SearchModal({ onClose }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectNode = useProjectStore((s) => s.selectNode)
  const setPendingReveal = useProjectStore((s) => s.setPendingReveal)
  const setView = useProjectStore((s) => s.setView)

  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const docHits = useMemo<DocHit[]>(() => {
    if (!project || query.trim().length < 2) return []
    const q = query.trim().toLowerCase()
    const qlen = query.trim().length
    const out: DocHit[] = []

    for (const node of Object.values(project.nodes)) {
      if (node.type === 'folder') continue
      const content = project.docs[node.id]?.content ?? ''
      const lower = content.toLowerCase()
      const titleMatch = node.title.toLowerCase().includes(q)

      const matches: DocHit['matches'] = []
      let idx = lower.indexOf(q)
      let total = 0
      while (idx !== -1) {
        total++
        if (matches.length < MAX_PER_DOC) matches.push(excerptParts(content, idx, qlen))
        idx = lower.indexOf(q, idx + qlen)
      }

      if (!titleMatch && total === 0) continue
      out.push({ nodeId: node.id, title: node.title, titleMatch, total, matches })
      if (out.length >= MAX_DOCS) break
    }
    // Docs with body matches first, then title-only matches.
    return out.sort((a, b) => b.total - a.total)
  }, [project, query])

  // Flatten to a keyboard-navigable list (one row per shown match; title-only
  // docs contribute a single row that opens the doc at its top).
  const rows = useMemo<FlatRow[]>(() => {
    const qlen = query.trim().length
    const r: FlatRow[] = []
    for (const d of docHits) {
      if (d.matches.length === 0) { r.push({ nodeId: d.nodeId, offset: 0, len: 0 }); continue }
      for (const m of d.matches) r.push({ nodeId: d.nodeId, offset: m.offset, len: qlen })
    }
    return r
  }, [docHits, query])

  useEffect(() => { setActive(0) }, [query])

  const open = (row: FlatRow) => {
    if (row.len > 0) setPendingReveal({ docId: row.nodeId, from: row.offset, len: row.len })
    setView('editor')
    selectNode(row.nodeId)
    onClose()
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    if (e.key === 'Enter') { e.preventDefault(); if (rows[active]) open(rows[active]) }
  }

  // Keep the active row in view as the user arrows through.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const totalMatches = docHits.reduce((a, d) => a + d.total, 0)
  let rowIdx = -1   // running index aligned with `rows`

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 660 }} role="dialog" aria-modal="true" aria-label="Search Project">
        <div className="modal-hd" style={{ paddingBottom: 0 }}>
          <input
            ref={inputRef}
            className="search-input"
            placeholder="Search project…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            style={{
              width: '100%', background: 'var(--bg-2)', border: '1px solid var(--border-2)',
              borderRadius: 8, padding: '9px 12px', fontSize: 14, color: 'var(--text)', outline: 'none',
            }}
          />
        </div>
        <div ref={listRef} className="modal-body" style={{ maxHeight: 440, overflowY: 'auto', padding: '8px 0' }}>
          {query.trim().length < 2 ? (
            <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: '40px 0', fontSize: 13 }}>
              Type at least 2 characters · ↑↓ to navigate · ↵ to open
            </div>
          ) : docHits.length === 0 ? (
            <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: '40px 0', fontSize: 13 }}>
              No results for "{query.trim()}"
            </div>
          ) : docHits.map((d) => {
            const headerRowIdx = d.matches.length === 0 ? ++rowIdx : -1
            return (
              <div key={d.nodeId} style={{ marginBottom: 4 }}>
                <div
                  data-row={headerRowIdx >= 0 ? headerRowIdx : undefined}
                  onClick={() => open({ nodeId: d.nodeId, offset: d.matches[0]?.offset ?? 0, len: d.matches.length ? query.trim().length : 0 })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 20px',
                    cursor: 'pointer',
                    background: headerRowIdx === active ? 'var(--bg-3)' : 'transparent',
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: d.titleMatch ? 'var(--accent)' : 'var(--text)' }}>
                    {d.title}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {d.total > 0 ? `${d.total} match${d.total !== 1 ? 'es' : ''}` : 'title'}
                  </span>
                </div>
                {d.matches.map((m, i) => {
                  const idx = ++rowIdx
                  return (
                    <button
                      key={i}
                      data-row={idx}
                      onClick={() => open({ nodeId: d.nodeId, offset: m.offset, len: query.trim().length })}
                      onMouseEnter={() => setActive(idx)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left', border: 'none',
                        padding: '5px 20px 5px 30px', cursor: 'pointer',
                        background: idx === active ? 'var(--bg-2)' : 'transparent',
                      }}
                    >
                      <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, fontFamily: 'var(--mono)', wordBreak: 'break-word' }}>
                        {m.pre}
                        <mark style={{ background: 'var(--accent-soft)', color: 'var(--text)', borderRadius: 2, padding: '0 1px' }}>{m.mid}</mark>
                        {m.post}
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
        <div className="modal-foot">
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {totalMatches > 0 ? `${totalMatches} match${totalMatches !== 1 ? 'es' : ''} in ${docHits.length} doc${docHits.length !== 1 ? 's' : ''}` : ''}
          </span>
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
