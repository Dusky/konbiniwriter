import React from 'react'
import { useProjectStore, descendants } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
import { kbd } from '../../lib/kbd'
import Editor from './Editor'
import Scrivenings from './Scrivenings'
import EditorBar from './EditorBar'
import TabStrip from './TabStrip'
import Icon from '../common/Icon'
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
  const applyMutation = useProjectStore((s) => s.applyMutation)
  const setRenamingId = useProjectStore((s) => s.setRenamingId)
  const setModal = useShellStore((s) => s.setModal)

  const createFirstDoc = async () => {
    const p = useProjectStore.getState().project
    if (!p) return
    const result = await window.api.node.mutate(p.id, { type: 'create', parentId: null, nodeType: 'document' })
    applyMutation(result)
    const newId = Object.values(result.nodes).find((n) => n.ext['_newId'])?.id
    if (newId) { selectNode(newId); setRenamingId(newId) }
  }

  // The effective docId for this pane
  const selectedId = nodeId !== undefined ? nodeId : storeSelectedId

  if (!project) {
    return (
      <div className="main">
        <div className="empty-state">
          <div className="wm"><Icon name="sparkle" /></div>
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
          borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
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
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div className="wm"><Icon name="sparkle" /></div>
            <div className="big">Pick up where you left off</div>
            <p style={{ color: 'var(--text-3)', fontSize: 13, margin: '4px 0 0' }}>
              Choose a document in the binder, or start a new one.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button className="btn primary" onClick={createFirstDoc}>
                <Icon name="plus" size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
                New document <span style={{ opacity: 0.7, marginLeft: 6 }}>{kbd('mod+shift+d')}</span>
              </button>
              <button className="btn" onClick={() => setModal('command-palette')}>
                Command palette <span style={{ opacity: 0.7, marginLeft: 6 }}>{kbd('mod+k')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (selectedNode.type === 'folder') {
    const hasScenes = descendants(project, selectedId).some((id) => project.nodes[id]?.type !== 'folder')
    // Scrivenings: edit all of a folder's scenes as one continuous document.
    // (Main pane only in v1; split panes keep the placeholder.)
    if (hasScenes && !splitOpen) {
      return (
        <div className="main" style={{ display: 'flex', flexDirection: 'column' }}>
          {tabs}
          <div className="doc-bar">
            <span className="crumb"><Icon name="folder" style={{ verticalAlign: '-2px', marginRight: 4 }} /><b>{selectedNode.title}</b></span>
            <span className="crumb" style={{ marginLeft: 8 }}>Scrivenings</span>
          </div>
          <div className="editor-wrap" style={{ flex: 1, minHeight: 0 }}>
            <div className="editor-col">
              <Scrivenings key={selectedId} folderId={selectedId} />
            </div>
          </div>
          <EditorBar nodeId={selectedId} scrivenings />
        </div>
      )
    }
    return (
      <div className="main" style={{ display: 'flex', flexDirection: 'column' }}>
        {tabs}
        {paneHeader}
        <div className="empty-state" style={{ flex: 1 }}>
          <div className="wm"><Icon name="folder" /></div>
          <div className="big">{selectedNode.title}</div>
          <p style={{ color: 'var(--text-3)', fontSize: 13 }}>
            {hasScenes ? 'Switch to Corkboard or Outliner to see children' : 'This folder has no documents yet'}
          </p>
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
      <EditorBar nodeId={selectedId} />
    </div>
  )
}
