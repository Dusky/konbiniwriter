import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
import { createProposal } from '../../lib/ProposalService'
import { makeMatcher, countMatches, replaceWith } from '../../lib/findReplace'
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
  const queueProposal = useProjectStore((s) => s.queueProposal)
  const setToast = useShellStore((s) => s.setToast)

  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const matcher = useMemo(
    () => (query.trim().length >= 2 ? makeMatcher(query.trim(), { caseSensitive, wholeWord }) : null),
    [query, caseSensitive, wholeWord],
  )

  const docHits = useMemo<DocHit[]>(() => {
    if (!project || !matcher) return []
    const out: DocHit[] = []
    for (const node of Object.values(project.nodes)) {
      if (node.type === 'folder') continue
      const content = project.docs[node.id]?.content ?? ''
      const titleMatch = countMatches(node.title, matcher) > 0

      const matches: DocHit['matches'] = []
      let total = 0
      matcher.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = matcher.exec(content)) !== null) {
        total++
        if (matches.length < MAX_PER_DOC) matches.push(excerptParts(content, m.index, m[0].length))
        if (m.index === matcher.lastIndex) matcher.lastIndex++ // guard zero-width
      }

      if (!titleMatch && total === 0) continue
      out.push({ nodeId: node.id, title: node.title, titleMatch, total, matches })
      if (out.length >= MAX_DOCS) break
    }
    return out.sort((a, b) => b.total - a.total)
  }, [project, matcher])

  // Flatten to a keyboard-navigable list (one row per shown match; title-only
  // docs contribute a single row that opens the doc at its top).
  const rows = useMemo<FlatRow[]>(() => {
    const r: FlatRow[] = []
    for (const d of docHits) {
      if (d.matches.length === 0) { r.push({ nodeId: d.nodeId, offset: 0, len: 0 }); continue }
      for (const m of d.matches) r.push({ nodeId: d.nodeId, offset: m.offset, len: m.mid.length })
    }
    return r
  }, [docHits])

  useEffect(() => { setActive(0) }, [query, caseSensitive, wholeWord])

  const open = (row: FlatRow) => {
    if (row.len > 0) setPendingReveal({ docId: row.nodeId, from: row.offset, len: row.len })
    setView('editor')
    selectNode(row.nodeId)
    onClose()
  }

  // Queue a reviewable, snapshot-protected replace proposal per affected doc.
  // Scans ALL docs (not just the display-capped set), body content only.
  const doReplace = (onlyDocId?: ID) => {
    if (!project || !matcher) return
    let queued = 0
    for (const node of Object.values(project.nodes)) {
      if (node.type === 'folder') continue
      if (onlyDocId && node.id !== onlyDocId) continue
      const content = project.docs[node.id]?.content ?? ''
      if (countMatches(content, matcher) === 0) continue
      const proposed = replaceWith(content, matcher, replacement)
      if (proposed === content) continue
      queueProposal(createProposal({
        docId: node.id,
        docTitle: node.title,
        command: 'revision',
        group: 'find-replace',
        label: `Replace "${query.trim()}" → "${replacement}"`,
        original: content,
        proposed,
        scope: 'document',
      }))
      queued++
    }
    if (queued === 0) { setToast('Nothing to replace.', 'info') }
    else setToast(`Queued ${queued} document${queued !== 1 ? 's' : ''} for review.`, 'success')
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

  // Affected-doc totals for the replace footer (uncapped, body only).
  const affected = useMemo(() => {
    if (!project || !matcher) return { docs: 0, matches: 0 }
    let docs = 0, matches = 0
    for (const node of Object.values(project.nodes)) {
      if (node.type === 'folder') continue
      const n = countMatches(project.docs[node.id]?.content ?? '', matcher)
      if (n > 0) { docs++; matches += n }
    }
    return { docs, matches }
  }, [project, matcher])

  const totalMatches = docHits.reduce((a, d) => a + d.total, 0)
  const canReplace = affected.docs > 0
  let rowIdx = -1   // running index aligned with `rows`

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 660 }} role="dialog" aria-modal="true" aria-label="Search & Replace">
        <div className="modal-hd" style={{ paddingBottom: 0, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <input
            ref={inputRef}
            className="srch-input"
            placeholder="Search project…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
          />
          <div className="srch-replace-row">
            <input
              className="srch-input srch-replace"
              placeholder="Replace with…"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
            />
            <button className={`srch-opt${caseSensitive ? ' on' : ''}`} title="Match case" aria-pressed={caseSensitive} onClick={() => setCaseSensitive((v) => !v)}>Aa</button>
            <button className={`srch-opt${wholeWord ? ' on' : ''}`} title="Whole word" aria-pressed={wholeWord} onClick={() => setWholeWord((v) => !v)}>⟦W⟧</button>
          </div>
        </div>
        <div ref={listRef} className="modal-body srch-body">
          {query.trim().length < 2 ? (
            <div className="srch-empty">
              Type at least 2 characters · ↑↓ to navigate · ↵ to open
            </div>
          ) : docHits.length === 0 ? (
            <div className="srch-empty">
              No results for "{query.trim()}"
            </div>
          ) : docHits.map((d) => {
            const headerRowIdx = d.matches.length === 0 ? ++rowIdx : -1
            return (
              <div key={d.nodeId} className="srch-doc">
                <div
                  data-row={headerRowIdx >= 0 ? headerRowIdx : undefined}
                  className={`srch-doc-hd${headerRowIdx === active ? ' on' : ''}`}
                  onClick={() => open({ nodeId: d.nodeId, offset: d.matches[0]?.offset ?? 0, len: d.matches[0]?.mid.length ?? 0 })}
                >
                  <span className={`srch-doc-title${d.titleMatch ? ' match' : ''}`}>
                    {d.title}
                  </span>
                  <span className="hint">
                    {d.total > 0 ? `${d.total} match${d.total !== 1 ? 'es' : ''}` : 'title'}
                  </span>
                  {canReplace && d.total > 0 && (
                    <button
                      className="srch-doc-replace"
                      title="Replace in this document (review)"
                      onClick={(e) => { e.stopPropagation(); doReplace(d.nodeId) }}
                    >Replace</button>
                  )}
                </div>
                {d.matches.map((m, i) => {
                  const idx = ++rowIdx
                  return (
                    <button
                      key={i}
                      data-row={idx}
                      className={`srch-hit${idx === active ? ' on' : ''}`}
                      onClick={() => open({ nodeId: d.nodeId, offset: m.offset, len: m.mid.length })}
                      onMouseEnter={() => setActive(idx)}
                    >
                      <div className="srch-hit-txt">
                        {m.pre}
                        <mark>{m.mid}</mark>
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
          <span className="hint">
            {totalMatches > 0 ? `${totalMatches} match${totalMatches !== 1 ? 'es' : ''} in ${docHits.length} doc${docHits.length !== 1 ? 's' : ''}` : ''}
          </span>
          <span className="tb-spacer" />
          {canReplace && (
            <button className="btn primary" onClick={() => doReplace()} title="Queue a reviewable replace for every affected document">
              Replace all — {affected.matches} in {affected.docs} doc{affected.docs !== 1 ? 's' : ''}
            </button>
          )}
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
