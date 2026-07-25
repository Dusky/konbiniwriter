import React from 'react'
import { useProjectStore } from '../../store/projectStore'
import Icon from '../common/Icon'
import { VIEW_TABS } from '../views/viewTabs'

// Horizontal strip of open tabs above the editor: document tabs (backed by a
// node) followed by app-view tabs (Stats, Foundation, …). The active tab is a
// document (selectedId, when no view tab is active) or a view tab. Clicking
// activates it; the × (or middle-click) closes it.
export default function TabStrip(): React.ReactElement | null {
  const project = useProjectStore((s) => s.project)
  const openTabs = useProjectStore((s) => s.openTabs)
  const selectedId = useProjectStore((s) => s.selectedId)
  const selectNode = useProjectStore((s) => s.selectNode)
  const closeTab = useProjectStore((s) => s.closeTab)
  const openViewTabs = useProjectStore((s) => s.openViewTabs)
  const activeViewTab = useProjectStore((s) => s.activeViewTab)
  const selectViewTab = useProjectStore((s) => s.selectViewTab)
  const closeViewTab = useProjectStore((s) => s.closeViewTab)

  if (!project) return null
  // Drop tabs whose node no longer exists (e.g. deleted while open).
  const tabs = openTabs.filter((id) => project.nodes[id])
  const viewTabs = openViewTabs.filter((v) => VIEW_TABS[v])
  if (tabs.length === 0 && viewTabs.length === 0) return null

  const tabBase: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
    padding: '0 8px 0 12px', maxWidth: 200, flexShrink: 0,
    fontSize: 12, whiteSpace: 'nowrap', borderRight: '1px solid var(--border)',
  }
  const closeBtn = (onClose: () => void, label: string) => (
    <button
      className="linkish"
      onClick={(e) => { e.stopPropagation(); onClose() }}
      title="Close tab"
      aria-label={label}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 16, height: 16, borderRadius: 3, flexShrink: 0,
        color: 'var(--text-3)', fontSize: 13, lineHeight: 1,
      }}
    >
      ×
    </button>
  )

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
        const active = id === selectedId && !activeViewTab
        return (
          <div
            key={id}
            role="tab"
            aria-selected={active}
            onClick={() => selectNode(id)}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(id) } }}
            title={node.title}
            style={{
              ...tabBase,
              color: active ? 'var(--text)' : 'var(--text-3)',
              background: active ? 'var(--bg)' : 'transparent',
              borderTop: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.title}</span>
            {closeBtn(() => closeTab(id), `Close ${node.title}`)}
          </div>
        )
      })}
      {viewTabs.map((v) => {
        const def = VIEW_TABS[v]!
        const active = activeViewTab === v
        return (
          <div
            key={v}
            role="tab"
            aria-selected={active}
            onClick={() => selectViewTab(v)}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeViewTab(v) } }}
            title={def.label}
            style={{
              ...tabBase,
              color: active ? 'var(--text)' : 'var(--text-3)',
              background: active ? 'var(--bg)' : 'transparent',
              borderTop: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
            }}
          >
            <Icon name={def.icon} size={13} style={{ flexShrink: 0, opacity: active ? 1 : 0.8 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{def.label}</span>
            {closeBtn(() => closeViewTab(v), `Close ${def.label}`)}
          </div>
        )
      })}
    </div>
  )
}
