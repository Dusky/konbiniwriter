import React from 'react'
import { useProjectStore } from '../../store/projectStore'

// Horizontal strip of open-document tabs above the editor. selectedId is the
// active tab; clicking a tab activates it, the × (or middle-click) closes it.
export default function TabStrip(): React.ReactElement | null {
  const project = useProjectStore((s) => s.project)
  const openTabs = useProjectStore((s) => s.openTabs)
  const selectedId = useProjectStore((s) => s.selectedId)
  const selectNode = useProjectStore((s) => s.selectNode)
  const closeTab = useProjectStore((s) => s.closeTab)

  if (!project) return null
  // Drop tabs whose node no longer exists (e.g. deleted while open).
  const tabs = openTabs.filter((id) => project.nodes[id])
  if (tabs.length === 0) return null

  return (
    <div
      role="tablist"
      style={{
        display: 'flex', alignItems: 'stretch', gap: 1, flexShrink: 0,
        borderBottom: '1px solid var(--border)', background: 'var(--bg-2)',
        overflowX: 'auto', minHeight: 34,
      }}
    >
      {tabs.map((id) => {
        const node = project.nodes[id]
        const active = id === selectedId
        return (
          <div
            key={id}
            role="tab"
            aria-selected={active}
            onClick={() => selectNode(id)}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(id) } }}
            title={node.title}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
              padding: '0 8px 0 12px', maxWidth: 200, flexShrink: 0,
              fontSize: 12, whiteSpace: 'nowrap',
              color: active ? 'var(--text)' : 'var(--text-3)',
              background: active ? 'var(--bg)' : 'transparent',
              borderTop: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
              borderRight: '1px solid var(--border)',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.title}</span>
            <button
              className="linkish"
              onClick={(e) => { e.stopPropagation(); closeTab(id) }}
              title="Close tab"
              aria-label={`Close ${node.title}`}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                color: 'var(--text-3)', fontSize: 13, lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
