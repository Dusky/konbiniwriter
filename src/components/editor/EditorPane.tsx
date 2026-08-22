import React, { useState } from 'react'
import { useProjectStore, descendants } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
import { kbd } from '../../lib/kbd'
import Editor from './Editor'
import Scrivenings from './Scrivenings'
import EditorBar from './EditorBar'
import TabStrip from './TabStrip'
import Icon from '../common/Icon'
import DocPicker from './DocPicker'
import { isNodeDrag, getNodeDrag } from '../../lib/nodeDnd'
import Corkboard from '../views/Corkboard'
import Outliner from '../views/Outliner'
import Timeline from '../views/Timeline'
import { VIEW_TABS } from '../views/viewTabs'

interface Props {
  nodeId?: string
  splitOpen?: boolean
  pane?: 'left' | 'right'
}

export default function EditorPane({ nodeId, splitOpen, pane }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const storeSelectedId = useProjectStore((s) => s.selectedId)
  const view = useProjectStore((s) => s.view)
  const activeViewTab = useProjectStore((s) => s.activeViewTab)
  const closeViewTab = useProjectStore((s) => s.closeViewTab)
  const openViewTab = useProjectStore((s) => s.openViewTab)
  const selectNode = useProjectStore((s) => s.selectNode)
  const setSplitId = useProjectStore((s) => s.setSplitId)
  const applyMutation = useProjectStore((s) => s.applyMutation)
  const setRenamingId = useProjectStore((s) => s.setRenamingId)
  const setModal = useShellStore((s) => s.setModal)
  const [dropActive, setDropActive] = useState(false)

  // Show a document in *this* pane. The right pane tracks its own id; the left
  // pane is the one that follows the global selection.
  const openHere = (id: string) => {
    if (pane === 'right') setSplitId(id)
    else selectNode(id)
  }

  // Dropping a node from the binder, outliner or corkboard opens it here.
  // Only the drag's *types* are readable during dragover — browsers withhold
  // the payload until drop — so the affordance keys off that.
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!isNodeDrag(e.dataTransfer)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      if (!dropActive) setDropActive(true)
    },
    onDragLeave: (e: React.DragEvent) => {
      // Ignore moves between the pane's own children.
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setDropActive(false)
    },
    onDrop: (e: React.DragEvent) => {
      setDropActive(false)
      const id = getNodeDrag(e.dataTransfer)
      if (!id || !useProjectStore.getState().project?.nodes[id]) return
      e.preventDefault()
      openHere(id)
    },
  }
  const paneCls = `main${dropActive ? ' pane-drop' : ''}`
  // Landmark roles rather than a <main> element: split view renders two of these
  // and a page may only have one main. The left pane is the document you are
  // working in; the right is a secondary region.
  const paneRole = pane === 'right'
    ? { role: 'region', 'aria-label': 'Second editor pane' }
    : { role: 'main', 'aria-label': 'Editor' }

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

  // App-view tab active (Stats, Foundation, …) → render that surface in the main
  // pane, keeping the tab strip on top. Split panes are document-only.
  if (activeViewTab && !splitOpen) {
    const def = VIEW_TABS[activeViewTab]
    return (
      <div className={paneCls} {...paneRole} style={{ display: 'flex', flexDirection: 'column' }} {...dropProps}>
        <TabStrip />
        {def ? def.render(() => closeViewTab(activeViewTab)) : null}
      </div>
    )
  }

  // In split view the browsing modes belong to the LEFT pane only; the right
  // pane stays an editor. Otherwise switching to the outliner replaced both
  // panes with the same table, leaving nothing to browse *into* — and making
  // "drag a row from the outline into the other pane" impossible to perform.
  if (!splitOpen || pane === 'left') {
    if (view === 'corkboard') return <Corkboard />
    if (view === 'outliner')  return <Outliner />
    if (view === 'timeline')  return <Timeline />
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
      <DocPicker value={selectedId ?? null} onPick={openHere} />
    </div>
  ) : null

  // Editor view
  if (!selectedId || !selectedNode) {
    return (
      <div className={paneCls} {...paneRole} style={{ display: 'flex', flexDirection: 'column' }} {...dropProps}>
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
              {/* This is the screen a lost author stares at, so it is where the
                  Guide has to be reachable from. */}
              <button className="btn" onClick={() => openViewTab('guide')}>
                <Icon name="book" size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
                Guide
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
    // Available in split panes too — dropping a folder into one used to dead-end
    // on a placeholder, which made the drop look broken rather than unsupported.
    if (hasScenes) {
      return (
        <div className={paneCls} {...paneRole} style={{ display: 'flex', flexDirection: 'column' }} {...dropProps}>
          {tabs}
          <div className="doc-bar">
            <span className="crumb"><Icon name="folder" style={{ verticalAlign: '-2px', marginRight: 4 }} /><b>{selectedNode.title}</b></span>
            <span className="crumb" style={{ marginLeft: 8 }}>Scrivenings</span>
          </div>
          <div className="editor-wrap" style={{ flex: 1, minHeight: 0 }}>
            <div className="editor-col">
              <Scrivenings key={selectedId} folderId={selectedId} onOpenScene={openHere} />
            </div>
          </div>
          <EditorBar nodeId={selectedId} scrivenings />
        </div>
      )
    }
    return (
      <div className={paneCls} {...paneRole} style={{ display: 'flex', flexDirection: 'column' }} {...dropProps}>
        {tabs}
        {paneHeader}
        <div className="empty-state" style={{ flex: 1 }}>
          <div className="wm"><Icon name="folder" /></div>
          <div className="big">{selectedNode.title}</div>
          <p style={{ color: 'var(--text-3)', fontSize: 13 }}>
            {/* The only way to reach this now is an empty folder: one with
                scenes renders them as Scrivenings in either pane. */}
            This folder has no documents yet
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
    <div className={paneCls} {...paneRole} style={{ display: 'flex', flexDirection: 'column' }} {...dropProps}>
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
