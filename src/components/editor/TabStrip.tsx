import React, { useState } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
import Icon from '../common/Icon'
import ContextMenu, { type MenuItem } from '../common/ContextMenu'
import { kbd } from '../../lib/kbd'
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
  const closeOtherTabs = useProjectStore((s) => s.closeOtherTabs)
  const closeAllTabs = useProjectStore((s) => s.closeAllTabs)
  const revealInBinder = useProjectStore((s) => s.revealInBinder)
  const setSplitId = useProjectStore((s) => s.setSplitId)
  const splitOpen = useProjectStore((s) => s.splitOpen)
  const toggleSplit = useProjectStore((s) => s.toggleSplit)
  const setToast = useShellStore((s) => s.setToast)

  const [ctx, setCtx] = useState<{ x: number; y: number; id: string } | null>(null)

  if (!project) return null
  // Drop tabs whose node no longer exists (e.g. deleted while open).
  const tabs = openTabs.filter((id) => project.nodes[id])
  const viewTabs = openViewTabs.filter((v) => VIEW_TABS[v])
  if (tabs.length === 0 && viewTabs.length === 0) return null

  // A tab strip you can't manage is a tab strip that fills up and stays full.
  const tabMenu = (id: string): MenuItem[] => {
    const node = project.nodes[id]
    if (!node) return []
    const copy = (text: string, what: string) => {
      navigator.clipboard.writeText(text)
        .then(() => setToast(`${what} copied`, 'info'))
        .catch(() => setToast('Clipboard is not available'))
    }
    return [
      { label: 'Close', icon: 'x', action: () => closeTab(id) },
      { label: 'Close Others', disabled: openTabs.length < 2, action: () => closeOtherTabs(id) },
      { label: 'Close All', disabled: openTabs.length === 0, action: () => closeAllTabs() },
      { label: '---' },
      {
        label: 'Open in Split',
        icon: 'columns',
        hint: kbd('mod+\\'),
        action: () => { if (!splitOpen) toggleSplit(); setSplitId(id) },
      },
      { label: 'Reveal in Binder', icon: 'panel-left', action: () => revealInBinder(id) },
      { label: '---' },
      { label: 'Copy Title', action: () => copy(node.title, 'Title') },
      { label: 'Copy as Wikilink', action: () => copy(`[[${node.title}]]`, 'Wikilink') },
    ]
  }

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
            onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, id }) }}
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
      {ctx && (
        <ContextMenu x={ctx.x} y={ctx.y} items={tabMenu(ctx.id)} onClose={() => setCtx(null)} />
      )}
    </div>
  )
}
