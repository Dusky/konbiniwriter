import React from 'react'
import { useProjectStore } from '../../store/projectStore'
import Editor from './Editor'
import Corkboard from '../views/Corkboard'
import Outliner from '../views/Outliner'

export default function EditorPane(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const view = useProjectStore((s) => s.view)

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

  // Editor view
  if (!selectedId || !selectedNode) {
    return (
      <div className="main">
        <div className="empty-state">
          <div className="wm">✦</div>
          <div className="big">Select a document to write</div>
        </div>
      </div>
    )
  }

  if (selectedNode.type === 'folder') {
    return (
      <div className="main">
        <div className="empty-state">
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
    <div className="main">
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
      <div className="editor-wrap">
        <div className="editor-col">
          <Editor key={selectedId} docId={selectedId} />
        </div>
      </div>
    </div>
  )
}
