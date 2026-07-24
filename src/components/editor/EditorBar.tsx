import React, { useState } from 'react'
import { useProjectStore, subtreeWordCount, descendants } from '../../store/projectStore'
import { useShellStore, type EditorBarWidget } from '../../store/shellStore'
import { wordCount, charCount } from '@shared/utils'
import Icon from '../common/Icon'

interface Props {
  /** The node this pane is showing (a doc, or the scrivenings folder). */
  nodeId: string
  /** True when the pane is a folder rendered as Scrivenings. */
  scrivenings?: boolean
}

const LABELS: Record<EditorBarWidget, string> = {
  render: 'Render mode', words: 'Word count', chars: 'Character count', cursor: 'Cursor position',
  reading: 'Reading time', target: 'Target progress', focus: 'Focus mode', typewriter: 'Typewriter',
}

type Proj = NonNullable<ReturnType<typeof useProjectStore.getState>['project']>
function subtreeChars(project: Proj, id: string): number {
  return descendants(project, id)
    .filter((d) => project.nodes[d]?.type !== 'folder')
    .reduce((acc, d) => acc + charCount(project.docs[d]?.content ?? ''), 0)
}

export default function EditorBar({ nodeId, scrivenings }: Props): React.ReactElement | null {
  const project = useProjectStore((s) => s.project)
  const cursor = useProjectStore((s) => s.cursor)
  const focusMode = useProjectStore((s) => s.focusMode)
  const setFocusMode = useProjectStore((s) => s.setFocusMode)
  const typewriterMode = useShellStore((s) => s.typewriterMode)
  const setTypewriterMode = useShellStore((s) => s.setTypewriterMode)
  const livePreviewOn = useShellStore((s) => s.livePreview)
  const setLivePreview = useShellStore((s) => s.setLivePreview)
  const editorBar = useShellStore((s) => s.editorBar)
  const setEditorBar = useShellStore((s) => s.setEditorBar)
  const setEditorBarItem = useShellStore((s) => s.setEditorBarItem)
  const resetEditorBar = useShellStore((s) => s.resetEditorBar)

  const [menuOpen, setMenuOpen] = useState(false)
  const [dragId, setDragId] = useState<EditorBarWidget | null>(null)

  if (!project) return null
  const node = project.nodes[nodeId]

  const content = !scrivenings ? (project.docs[nodeId]?.content ?? '') : ''
  const words = scrivenings ? subtreeWordCount(project, nodeId) : wordCount(content)
  const chars = scrivenings ? subtreeChars(project, nodeId) : charCount(content)
  const target = !scrivenings ? (node?.meta.target ?? 0) : 0
  const reading = Math.max(1, Math.ceil(words / 200))

  const reorder = (from: EditorBarWidget, to: EditorBarWidget) => {
    if (from === to) return
    const arr = [...editorBar]
    const fi = arr.findIndex((i) => i.id === from)
    if (fi < 0 || arr.findIndex((i) => i.id === to) < 0) return
    const [moved] = arr.splice(fi, 1)
    arr.splice(arr.findIndex((i) => i.id === to), 0, moved) // insert before the drop target
    setEditorBar(arr)
  }

  const widget = (id: EditorBarWidget): React.ReactNode => {
    switch (id) {
      case 'render':
        return (
          <button className="ebar-btn" onClick={() => setLivePreview(!livePreviewOn)}
            title={livePreviewOn ? 'Showing rendered markdown — click for raw' : 'Showing raw markdown — click to render'}>
            <Icon name={livePreviewOn ? 'eye' : 'document'} size={13} />
            {livePreviewOn ? 'Rendered' : 'Raw'}
          </button>
        )
      case 'words':
        return <span className="ebar-stat"><b>{words.toLocaleString()}</b> words</span>
      case 'chars':
        return <span className="ebar-stat"><b>{chars.toLocaleString()}</b> chars</span>
      case 'cursor':
        return cursor ? <span className="ebar-stat">Ln <b>{cursor.line}</b>, Col <b>{cursor.col}</b></span> : null
      case 'reading':
        return <span className="ebar-stat"><b>{reading}</b> min read</span>
      case 'target':
        return target > 0
          ? <span className="ebar-stat" style={{ color: words / target >= 1 ? 'var(--st-final)' : undefined }}><b>{Math.round(Math.min(1, words / target) * 100)}%</b> of {target.toLocaleString()}</span>
          : null
      case 'focus':
        return (
          <button className={`ebar-btn${focusMode ? ' on' : ''}`} onClick={() => setFocusMode(!focusMode)} title="Focus mode">
            <Icon name="focus" size={13} />Focus
          </button>
        )
      case 'typewriter':
        return (
          <button className={`ebar-btn${typewriterMode ? ' on' : ''}`} onClick={() => setTypewriterMode(!typewriterMode)} title="Typewriter scroll">
            <Icon name="chevron-down" size={13} />Typewriter
          </button>
        )
    }
  }

  const visible = editorBar.filter((i) => i.visible)

  return (
    <div className="editor-bar">
      {visible.map((i) => {
        const el = widget(i.id)
        if (el == null) return null
        return (
          <span
            key={i.id}
            className={`ebar-item${dragId === i.id ? ' dragging' : ''}`}
            draggable
            onDragStart={() => setDragId(i.id)}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => { e.preventDefault() }}
            onDrop={(e) => { e.preventDefault(); if (dragId) reorder(dragId, i.id); setDragId(null) }}
          >
            {el}
          </span>
        )
      })}
      <span style={{ flex: 1 }} />
      <div className="ebar-menu-wrap">
        <button className="ebar-btn ebar-gear" title="Customize this bar" aria-label="Customize bar" onClick={() => setMenuOpen((o) => !o)}>
          <Icon name="settings" size={13} />
        </button>
        {menuOpen && (
          <>
            <div className="ebar-menu-scrim" onClick={() => setMenuOpen(false)} />
            <div className="ebar-menu" role="menu">
              <div className="ebar-menu-hd">Bar widgets</div>
              {editorBar.map((i) => (
                <label key={i.id} className="ebar-menu-row">
                  <input type="checkbox" checked={i.visible} onChange={(e) => setEditorBarItem(i.id, e.target.checked)} />
                  {LABELS[i.id]}
                </label>
              ))}
              <div className="ebar-menu-note">Drag widgets on the bar to reorder.</div>
              <button className="ebar-menu-reset" onClick={() => { resetEditorBar(); setMenuOpen(false) }}>Reset to default</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
