import React from 'react'
import { useProjectStore } from '../../store/projectStore'
import Editor from './Editor'
import TabStrip from './TabStrip'
import Corkboard from '../views/Corkboard'
import Outliner from '../views/Outliner'
import Timeline from '../views/Timeline'

interface Props {
  nodeId?: string
  splitOpen?: boolean
  pane?: 'left' | 'right'
}

export default function EditorPane({ nodeId, splitOpen, pane }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const storeSelectedId = useProjectStore((s) => s.selectedId)
  const view = useProjectStore((s) => s.view)
  const selectNode = useProjectStore((s) => s.selectNode)
  const setSplitId = useProjectStore((s) => s.setSplitId)

  // The effective docId for this pane
  const selectedId = nodeId !== undefined ? nodeId : storeSelectedId

  if (!project) {
    return (
      <div className="main">
        <div className="empty-state">
          <div className="wm">✦</div>
          <div className="big">No project open</div>
        </div>
      </div>
    )
  }

  const selectedNode = selectedId ? project.nodes[selectedId] : null

  if (view === 'corkboard') return <Corkboard />
  if (view === 'outliner')  return <Outliner />
  if (view === 'timeline')  return <Timeline />

  // Collect all non-folder nodes for the picker
  const docNodes = Object.values(project.nodes).filter((n) => n.type !== 'folder')

  const handlePickerChange = (id: string) => {
    if (pane === 'right') {
      setSplitId(id)
    } else {
      selectNode(id)
    }
  }

  // Open-document tabs belong to the single main editor (the pane that tracks
  // the global selection). In split mode each pane has its own picker instead.
  const tabs = !splitOpen ? <TabStrip /> : null

  const paneHeader = splitOpen ? (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 10px', borderBottom: '1px solid var(--border)',
      background: 'var(--bg-2)', flexShrink: 0, minHeight: 32,
    }}>
      <span style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 500, flexShrink: 0 }}>
        {pane === 'left' ? 'Left' : 'Right'}
      </span>
      <select
        value={selectedId ?? ''}
        onChange={(e) => handlePickerChange(e.target.value)}
        style={{
          flex: 1, minWidth: 0, fontSize: 12, padding: '2px 6px',
          borderRadius: 4, border: '1px solid var(--border)',
          background: 'var(--bg-2)', color: 'var(--text)', cursor: 'pointer',
        }}
      >
        <option value="" disabled>— pick a document —</option>
        {docNodes.map((n) => (
          <option key={n.id} value={n.id}>{n.title}</option>
        ))}
      </select>
    </div>
  ) : null

  // Editor view
  if (!selectedId || !selectedNode) {
    return (
      <div className="main" style={{ display: 'flex', flexDirection: 'column' }}>
        {tabs}
        {paneHeader}
        <div className="empty-state" style={{ flex: 1 }}>
          <div className="wm">✦</div>
          <div className="big">Select a document to write</div>
        </div>
      </div>
    )
  }

  if (selectedNode.type === 'folder') {
    return (
      <div className="main" style={{ display: 'flex', flexDirection: 'column' }}>
        {tabs}
        {paneHeader}
        <div className="empty-state" style={{ flex: 1 }}>
          <div className="wm">📁</div>
          <div className="big">{selectedNode.title}</div>
          <p style={{ color: 'var(--text-3)', fontSize: 13 }}>Switch to Corkboard or Outliner to see children</p>
        </div>
      </div>
    )
  }

  const ancestors: string[] = []
  let cur = selectedNode.parentId
  while (cur) {
    const n = project.nodes[cur]
    if (!n) break
    ancestors.unshift(n.title)
    cur = n.parentId
  }

  return (
    <div className="main" style={{ display: 'flex', flexDirection: 'column' }}>
      {tabs}
      {paneHeader}
      <div className="doc-bar">
        {ancestors.map((a, i) => (
          <React.Fragment key={i}>
            <span className="crumb">{a}</span>
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M5 2l4 5-4 5" />
            </svg>
          </React.Fragment>
        ))}
        <span className="crumb"><b>{selectedNode.title}</b></span>
      </div>
      <div className="editor-wrap" style={{ flex: 1, minHeight: 0 }}>
        <div className="editor-col">
          <Editor key={selectedId} docId={selectedId} />
        </div>
      </div>
    </div>
  )
}
