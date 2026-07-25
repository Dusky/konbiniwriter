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

  const closeBtn = (onClose: () => void, label: string) => (
    <button
      className="tab-x"
      onClick={(e) => { e.stopPropagation(); onClose() }}
      title="Close tab"
      aria-label={label}
    >
      <Icon name="x" size={11} />
    </button>
  )

  return (
    <div className="tab-strip" role="tablist">
      {tabs.map((id) => {
        const node = project.nodes[id]
        const active = id === selectedId && !activeViewTab
        return (
          <div
            key={id}
            role="tab"
            aria-selected={active}
            className={`tab${active ? ' on' : ''}`}
            onClick={() => selectNode(id)}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(id) } }}
            title={node.title}
          >
            <span className="tab-label">{node.title}</span>
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
            className={`tab${active ? ' on' : ''}`}
            onClick={() => selectViewTab(v)}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeViewTab(v) } }}
            title={def.label}
          >
            <Icon name={def.icon} size={13} className="tab-ic" />
            <span className="tab-label">{def.label}</span>
            {closeBtn(() => closeViewTab(v), `Close ${def.label}`)}
          </div>
        )
      })}
    </div>
  )
}
