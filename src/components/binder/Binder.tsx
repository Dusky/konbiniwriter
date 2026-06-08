import React, { useState, useRef, useEffect } from 'react'
import { useProjectStore, flattenVisible, subtreeWordCount, isDescendant } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
import ContextMenu, { type MenuItem } from './ContextMenu'
import { STATUS_META, fmtWords } from '@shared/utils'
import type { ID, NodeType } from '@shared/types'

type DropPos = 'before' | 'into' | 'after'

interface DragState {
  dragId: ID
  overId: ID | null
  dropPos: DropPos | null
}

export default function Binder(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const renamingId = useProjectStore((s) => s.renamingId)
  const selectNode = useProjectStore((s) => s.selectNode)
  const applyMutation = useProjectStore((s) => s.applyMutation)
  const setRenamingId = useProjectStore((s) => s.setRenamingId)
  const setModal = useShellStore((s) => s.setModal)

  const [ctx, setCtx] = useState<{ x: number; y: number; id: ID } | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  // When rename mode opens for a node — from any trigger (create, context menu,
  // keyboard) — seed the field with the node's current title and reliably move
  // focus into the input on the next frame, selecting the text so typing
  // replaces it. Doing this here (rather than relying on `autoFocus`) fixes the
  // timing races that left the input blurred after create.
  useEffect(() => {
    if (!renamingId) return
    const title = useProjectStore.getState().project?.nodes[renamingId]?.title ?? ''
    setRenameValue(title)
    const raf = requestAnimationFrame(() => {
      const el = renameInputRef.current
      if (el) { el.focus(); el.select() }
    })
    return () => cancelAnimationFrame(raf)
  }, [renamingId])

  if (!project) return <div className="binder" />

  const flat = flattenVisible(project)

  // ── IPC mutations ────────────────────────────────────────────────────────

  const mutate = async (op: Parameters<typeof window.api.node.mutate>[1]) => {
    const result = await window.api.node.mutate(project.id, op)
    applyMutation(result)
    return result
  }

  const createNode = async (parentId: ID | null, nodeType: NodeType) => {
    const result = await mutate({ type: 'create', parentId, nodeType })
    // The new node id is in result.nodes — find the node with _newId set
    const newId = Object.values(result.nodes).find((n) => n.ext['_newId'])?.id
    if (newId) { selectNode(newId); setRenamingId(newId) }
  }

  const handleRenameCommit = async (id: ID, title: string) => {
    setRenamingId(null)
    if (title.trim()) await mutate({ type: 'rename', id, title: title.trim() })
  }

  // ── Drag & Drop ──────────────────────────────────────────────────────────

  const calcDropPos = (e: React.DragEvent, id: ID): DropPos => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const ratio = (e.clientY - rect.top) / rect.height
    const node = project.nodes[id]
    if (ratio < 0.33) return 'before'
    if (ratio > 0.67 || node?.type !== 'folder') return 'after'
    return 'into'
  }

  const onDragOver = (e: React.DragEvent, id: ID) => {
    e.preventDefault()
    if (!drag) return
    if (id === drag.dragId) return
    if (isDescendant(project, drag.dragId, id)) return
    setDrag((d) => d ? { ...d, overId: id, dropPos: calcDropPos(e, id) } : d)
  }

  const onDrop = async (e: React.DragEvent, targetId: ID) => {
    e.preventDefault()
    if (!drag || drag.dragId === targetId) { setDrag(null); return }
    const { dragId, dropPos } = drag
    const target = project.nodes[targetId]
    if (!target || isDescendant(project, dragId, targetId)) { setDrag(null); return }

    let newParentId: ID | null
    let atIndex: number

    if (dropPos === 'into' && target.type === 'folder') {
      newParentId = targetId
      atIndex = target.childIds.length
    } else {
      newParentId = target.parentId
      const siblings = newParentId == null ? project.rootIds : project.nodes[newParentId]?.childIds ?? []
      const targetIdx = siblings.indexOf(targetId)
      atIndex = dropPos === 'after' ? targetIdx + 1 : targetIdx
    }

    setDrag(null)
    await mutate({ type: 'move', id: dragId, newParentId, atIndex })
  }

  // ── Context menu items ───────────────────────────────────────────────────

  const ctxItems = (id: ID): MenuItem[] => {
    const node = project.nodes[id]
    const inTrash = node?.parentId === project.trashId
    return [
      { label: 'New Document',  action: () => mutate({ type: 'create', parentId: id, nodeType: 'document' }) },
      { label: 'New Scene',     action: () => mutate({ type: 'create', parentId: id, nodeType: 'scene' }) },
      { label: 'New Folder',    action: () => mutate({ type: 'create', parentId: id, nodeType: 'folder' }) },
      { label: '---', action: () => {} },
      { label: 'Rename',        action: () => { setRenamingId(id); setRenameValue(node?.title ?? '') } },
      { label: 'Duplicate',     action: () => mutate({ type: 'duplicate', id }) },
      { label: 'Take Snapshot', action: () => { selectNode(id); setModal('snapshot') }, disabled: node?.type === 'folder' },
      { label: '---', action: () => {} },
      inTrash
        ? { label: 'Delete Permanently', action: () => mutate({ type: 'delete', id }), danger: true }
        : { label: 'Move to Trash', action: () => mutate({ type: 'trash', id }), danger: true },
    ]
  }

  return (
    <div className="binder">
      <div className="binder-hd">Binder</div>
      <div className="binder-scroll">
        {flat.map(({ id, depth }) => {
          const node = project.nodes[id]
          if (!node) return null
          const words = node.type !== 'folder' ? wordCount(project.docs[id]?.content ?? '') : subtreeWordCount(project, id)
          const statusColor = STATUS_META[node.meta.status]?.color ?? 'var(--text-3)'
          const isOver = drag?.overId === id
          const dropPos = isOver ? drag?.dropPos : null

          return (
            <React.Fragment key={id}>
              {isOver && dropPos === 'before' && <div className="drop-line" />}
              <div
                className={`tree-row${selectedId === id ? ' sel' : ''}${isOver && dropPos === 'into' ? ' drop-into' : ''}`}
                style={{ paddingLeft: `${depth * 15 + 4}px` }}
                onClick={() => { if (renamingId !== id) selectNode(id) }}
                onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, id }) }}
                draggable
                onDragStart={() => setDrag({ dragId: id, overId: null, dropPos: null })}
                onDragOver={(e) => onDragOver(e, id)}
                onDrop={(e) => onDrop(e, id)}
                onDragEnd={() => setDrag(null)}
              >
                {/* Expand twist for folders */}
                {node.type === 'folder' ? (
                  <span
                    className={`tw-twist${node.expanded ? ' open' : ''}`}
                    onClick={(e) => { e.stopPropagation(); mutate({ type: 'setExpanded', id, expanded: !node.expanded }) }}
                  >
                    <svg viewBox="0 0 9 9" fill="currentColor"><path d="M2 1l5 3.5L2 8z" /></svg>
                  </span>
                ) : (
                  <span className="tw-twist" />
                )}

                {/* Icon */}
                <span className="tw-icon">
                  {node.type === 'folder' ? '📁' : node.type === 'scene' ? '📄' : '📝'}
                </span>

                {/* Label / rename input */}
                <span className="tw-label">
                  {renamingId === id ? (
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => handleRenameCommit(id, renameValue)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameCommit(id, renameValue)
                        if (e.key === 'Escape') setRenamingId(null)
                        e.stopPropagation()
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    node.title
                  )}
                </span>

                {/* Word count */}
                {words > 0 && <span className="tw-count">{fmtWords(words)}</span>}

                {/* Status dot */}
                {node.type !== 'folder' && (
                  <span className="tw-status" style={{ background: statusColor }} title={node.meta.status} />
                )}
              </div>
              {isOver && dropPos === 'after' && <div className="drop-line" />}
            </React.Fragment>
          )
        })}
      </div>

      {/* Footer add buttons */}
      <div className="binder-foot">
        <button className="icon-btn" title="New Document (⌘⇧D)" onClick={() => {
          const parentId = selectedId && project.nodes[selectedId]?.type === 'folder' ? selectedId : null
          mutate({ type: 'create', parentId, nodeType: 'document' })
        }}>+</button>
        <button className="icon-btn" title="New Folder (⌘⌥N)" onClick={() => mutate({ type: 'create', parentId: null, nodeType: 'folder' })}>📁</button>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" title="Delete / Trash" onClick={() => selectedId && mutate({ type: 'trash', id: selectedId })}>🗑</button>
      </div>

      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          items={ctxItems(ctx.id)}
          onClose={() => setCtx(null)}
        />
      )}
    </div>
  )
}

function wordCount(s: string): number {
  const t = s.replace(/[#>*_~\-[\]`]/g, ' ').replace(/\s+/g, ' ').trim()
  return t ? t.split(/\s+/).length : 0
}
