import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useProjectStore, flattenVisible, subtreeWordCount, isDescendant } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
import ContextMenu from '../common/ContextMenu'
import { useNodeMenu } from '../common/useNodeMenu'
import ConfirmDialog from '../common/ConfirmDialog'
import Icon from '../common/Icon'
import SidebarResizer from '../common/SidebarResizer'
import BinderFilter from './BinderFilter'
import BinderRow, { type RowHandlers } from './BinderRow'
import { kbd } from '../../lib/kbd'
import { STATUS_META, fmtWords, wordCount } from '@shared/utils'
import type { ID, NodeType } from '@shared/types'
import { isEmptyQuery, runQuery } from '@shared/query'
import { setNodeDrag } from '../../lib/nodeDnd'

type DropPos = 'before' | 'into' | 'after'

interface DragState {
  dragId: ID
  overId: ID | null
  dropPos: DropPos | null
}

export default function Binder(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const selectedIds = useProjectStore((s) => s.selectedIds)
  const toggleSelect = useProjectStore((s) => s.toggleSelect)
  const selectRange = useProjectStore((s) => s.selectRange)
  const renamingId = useProjectStore((s) => s.renamingId)
  const selectNode = useProjectStore((s) => s.selectNode)
  const applyMutation = useProjectStore((s) => s.applyMutation)
  const setRenamingId = useProjectStore((s) => s.setRenamingId)
  const undoMutation = useProjectStore((s) => s.undoMutation)
  const redoMutation = useProjectStore((s) => s.redoMutation)
  const canUndo = useProjectStore((s) => s.nodeHistory.length > 0)
  const canRedo = useProjectStore((s) => s.nodeFuture.length > 0)
  const setRailPanel = useShellStore((s) => s.setRailPanel)
  const setToast = useShellStore((s) => s.setToast)
  const binderQuery = useProjectStore((s) => s.binderQuery)
  const clearBinderQuery = useProjectStore((s) => s.clearBinderQuery)

  const [ctx, setCtx] = useState<{ x: number; y: number; id: ID } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ID | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  // One shared builder for binder/corkboard/outliner, so a node offers the same
  // actions wherever it's right-clicked. Rename and the delete confirmation are
  // binder-only (nothing else can show the input or the dialog), so they're
  // injected rather than duplicated. Setting renamingId is enough — the effect
  // below seeds the field and focuses it.
  const nodeMenu = useNodeMenu({
    onRename: setRenamingId,
    onConfirmDelete: setConfirmDelete,
  })

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

  // A filtered binder is a flat result list, not a tree: the matches rarely
  // share a parent, and showing their ancestors just to hold them would put
  // non-matching rows back on screen. Nesting and drag-to-reorder both only
  // make sense against the real tree, so they're off while filtering.
  const filtering = !isEmptyQuery(binderQuery)
  const flat = filtering
    ? runQuery(project, binderQuery).map((id) => ({ id, depth: 0 }))
    : flattenVisible(project)

  // ── IPC mutations ────────────────────────────────────────────────────────

  // Every structural write funnels through here — a failed write must never
  // pass silently (the store was NOT updated, so the UI still matches disk).
  const mutate = async (op: Parameters<typeof window.api.node.mutate>[1]) => {
    try {
      const result = await window.api.node.mutate(project.id, op)
      applyMutation(result)
      return result
    } catch (e) {
      setToast('Change could not be saved: ' + (e as Error).message)
      return null
    }
  }

  const createNode = async (parentId: ID | null, nodeType: NodeType) => {
    const result = await mutate({ type: 'create', parentId, nodeType })
    if (!result) return
    // The new node id is in result.nodes — find the node with _newId set
    const newId = Object.values(result.nodes).find((n) => n.ext['_newId'])?.id
    if (newId) { selectNode(newId); setRenamingId(newId) }
  }

  // Late-bound so `rowHandlers` can stay stable while these close over the
  // current project and drag state.
  const onDragOverRef = useRef<(e: React.DragEvent, id: ID) => void>(() => {})
  const onDropRef = useRef<(e: React.DragEvent, id: ID) => Promise<void>>(async () => {})
  const mutateRef = useRef<(op: Parameters<typeof window.api.node.mutate>[1]) => Promise<unknown>>(async () => null)
  const renameCommitRef = useRef<(id: ID, title: string) => Promise<void>>(async () => {})

  const handleRenameCommit = async (id: ID, title: string) => {
    setRenamingId(null)
    if (title.trim()) await mutate({ type: 'rename', id, title: title.trim() })
  }

  // ── Row handlers ─────────────────────────────────────────────────────────
  //
  // One stable object for all rows. These must NOT change identity while the
  // writer is typing, or BinderRow's memo is defeated and every row reconciles
  // on each keystroke — which is the whole cost this indirection exists to
  // avoid. So anything that changes per-keystroke (`project`) is read fresh
  // from the store inside the callback rather than captured.
  const dragRef = useRef(drag)
  dragRef.current = drag

  const rowHandlers = useMemo<RowHandlers>(() => ({
    onClick: (id, e) => {
      if (useProjectStore.getState().renamingId === id) return
      // Shift extends from the active node; Ctrl/Cmd picks nodes one at a
      // time; a plain click collapses back to one.
      if (e.shiftKey) selectRange(id)
      else if (e.metaKey || e.ctrlKey) toggleSelect(id)
      else selectNode(id)
    },
    onContextMenu: (id, e) => {
      e.preventDefault()
      // Right-clicking outside the selection acts on what you clicked — so
      // make that the selection first.
      if (!useProjectStore.getState().selectedIds.includes(id)) selectNode(id)
      setCtx({ x: e.clientX, y: e.clientY, id })
    },
    onDragStart: (id, e) => {
      // Carries a node id so an editor pane can accept the drop too; within
      // the binder this is still a reorder. See lib/nodeDnd.
      setNodeDrag(e.dataTransfer, id)
      setDrag({ dragId: id, overId: null, dropPos: null })
    },
    onDragOver: (id, e) => onDragOverRef.current(e, id),
    onDrop: (id, e) => { void onDropRef.current(e, id) },
    onDragEnd: () => setDrag(null),
    onToggleExpand: (id, expanded) => { void mutateRef.current({ type: 'setExpanded', id, expanded }) },
    onRenameChange: setRenameValue,
    onRenameCommit: (id, v) => { void renameCommitRef.current(id, v) },
    onRenameCancel: () => setRenamingId(null),
  }), [selectNode, selectRange, toggleSelect, setRenamingId])

  // ── Drag & Drop ──────────────────────────────────────────────────────────

  // Takes a already-measured rect + pointer Y rather than the event: React nulls
  // out a synthetic event's `currentTarget` once the handler returns, and a
  // setState updater callback runs later (twice under StrictMode), so reading the
  // event in there threw inside React's reducer and unmounted the whole tree.
  const calcDropPos = (rect: DOMRect, clientY: number, id: ID): DropPos => {
    const ratio = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5
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
    // Measure eagerly, while the event is still live.
    const el = e.currentTarget as HTMLElement | null
    if (!el) return
    const dropPos = calcDropPos(el.getBoundingClientRect(), e.clientY, id)
    setDrag((d) => d ? { ...d, overId: id, dropPos } : d)
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

  // Refresh the late-bound refs every render so the stable handler object
  // above always calls the current closures.
  onDragOverRef.current = onDragOver
  onDropRef.current = onDrop
  mutateRef.current = mutate
  renameCommitRef.current = handleRenameCommit

  return (
    <div className="binder">
      <SidebarResizer edge="right" cssVar="--binder-w" prefKey="pref:binderWidth" min={180} max={480} fallback={264} />
      <div className="binder-hd">Binder</div>
      <BinderFilter />
      <div className="binder-scroll">
        {flat.length === 0 && (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 12.5, lineHeight: 1.6 }}>
            {filtering ? (
              <>
                <div style={{ marginBottom: 10 }}>Nothing matches this filter.</div>
                <button className="btn sm" onClick={clearBinderQuery}>Clear filter</button>
              </>
            ) : (
              <>
                <div style={{ marginBottom: 10 }}>Your project is empty.</div>
                <button className="btn sm" onClick={() => createNode(null, 'document')}>+ Create your first document</button>
              </>
            )}
          </div>
        )}
        {flat.map(({ id, depth }) => {
          const node = project.nodes[id]
          if (!node) return null
          const isOver = drag?.overId === id
          return (
            <BinderRow
              key={id}
              id={id}
              depth={depth}
              title={node.title}
              type={node.type}
              expanded={node.expanded}
              words={node.type !== 'folder' ? wordCount(project.docs[id]?.content ?? '') : subtreeWordCount(project, id)}
              statusColor={STATUS_META[node.meta.status]?.color ?? 'var(--text-3)'}
              status={node.meta.status}
              selected={selectedIds.includes(id)}
              current={selectedId === id}
              dragging={drag?.dragId === id}
              isOver={isOver}
              dropPos={isOver ? drag?.dropPos ?? null : null}
              filtering={filtering}
              renaming={renamingId === id}
              renameValue={renamingId === id ? renameValue : undefined}
              renameInputRef={renamingId === id ? renameInputRef : undefined}
              h={rowHandlers}
            />
          )
        })}
      </div>

      {/* Footer add buttons */}
      <div className="binder-foot">
        <button className="icon-btn" title={`New Document (${kbd('mod+shift+d')})`} onClick={() => {
          const parentId = selectedId && project.nodes[selectedId]?.type === 'folder' ? selectedId : null
          mutate({ type: 'create', parentId, nodeType: 'document' })
        }}><Icon name="plus" /></button>
        <button className="icon-btn" title={`New Folder (${kbd('mod+alt+n')})`} onClick={() => mutate({ type: 'create', parentId: null, nodeType: 'folder' })}><Icon name="folder" /></button>
        <button className="icon-btn" title={`Undo (${kbd('mod+z')})`} disabled={!canUndo} onClick={() => undoMutation()}><Icon name="undo" /></button>
        <button className="icon-btn" title={`Redo (${kbd('mod+shift+z')})`} disabled={!canRedo} onClick={() => redoMutation()}><Icon name="redo" /></button>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" title="Delete / Trash" onClick={() => selectedId && mutate({ type: 'trash', id: selectedId })}><Icon name="trash" /></button>
      </div>

      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          items={nodeMenu(ctx.id)}
          onClose={() => setCtx(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete Permanently"
          message={`"${project.nodes[confirmDelete]?.title ?? 'This item'}" and everything inside it will be deleted from disk. This cannot be undone.`}
          confirmLabel="Delete Permanently"
          onConfirm={() => { mutate({ type: 'delete', id: confirmDelete }); setConfirmDelete(null) }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
