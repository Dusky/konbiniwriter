import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useShellStore } from '../../store/shellStore'
import { useProjectStore } from '../../store/projectStore'
import type { ID } from '@shared/types'

interface Hit {
  nodeId: ID
  title: string
  excerpt: string
  matchStart: number
}

function buildExcerpt(content: string, query: string): string {
  const idx = content.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return content.slice(0, 80)
  const start = Math.max(0, idx - 40)
  const end = Math.min(content.length, idx + query.length + 60)
  return (start > 0 ? '…' : '') + content.slice(start, end) + (end < content.length ? '…' : '')
}

interface Props { onClose: () => void }

export default function SearchModal({ onClose }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectNode = useProjectStore((s) => s.selectNode)
  const setModal = useShellStore((s) => s.setModal)

  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const hits = useMemo<Hit[]>(() => {
    if (!project || query.trim().length < 2) return []
    const q = query.trim().toLowerCase()
    const results: Hit[] = []

    for (const node of Object.values(project.nodes)) {
      if (node.type === 'folder') continue
      const body = project.docs[node.id]
      const content = body?.content ?? ''
      const titleMatch = node.title.toLowerCase().includes(q)
      const contentMatch = content.toLowerCase().includes(q)
      if (!titleMatch && !contentMatch) continue
      results.push({
        nodeId: node.id,
        title: node.title,
        excerpt: buildExcerpt(content, query.trim()),
        matchStart: content.toLowerCase().indexOf(q),
      })
    }
    return results.slice(0, 50)
  }, [project, query])

  const handleSelect = (nodeId: ID) => {
    selectNode(nodeId)
    onClose()
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 640 }}>
        <div className="modal-hd" style={{ paddingBottom: 0 }}>
          <input
            ref={inputRef}
            className="search-input"
            placeholder="Search project…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            style={{
              width: '100%',
              background: 'var(--bg-2)',
              border: '1px solid var(--border-2)',
              borderRadius: 8,
              padding: '9px 12px',
              fontSize: 14,
              color: 'var(--text)',
              outline: 'none',
            }}
          />
        </div>
        <div className="modal-body" style={{ maxHeight: 420, overflowY: 'auto', padding: '8px 0' }}>
          {query.trim().length < 2 ? (
            <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: '40px 0', fontSize: 13 }}>
              Type at least 2 characters to search
            </div>
          ) : hits.length === 0 ? (
            <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: '40px 0', fontSize: 13 }}>
              No results for "{query}"
            </div>
          ) : hits.map((hit) => (
            <button
              key={hit.nodeId}
              onClick={() => handleSelect(hit.nodeId)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                padding: '10px 20px',
                cursor: 'pointer',
                borderBottom: '0.5px solid var(--border)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>
                {hit.title}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, fontFamily: 'var(--mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {hit.excerpt}
              </div>
            </button>
          ))}
        </div>
        <div className="modal-foot">
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {hits.length > 0 ? `${hits.length} result${hits.length !== 1 ? 's' : ''}` : ''}
          </span>
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
