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
  /** The row under the pointer — what the drag image and `.dragging` follow. */
  dragId: ID
  /**
   * Everything being moved, in binder order. Grabbing a row inside a
   * multi-selection drags the whole selection: moving three chapters used to
   * silently move only the one you happened to grab, which is the kind of thing
   * you don't notice until the manuscript is out of order.
   */
  ids: ID[]
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
  // Roving-tabindex focus. Deliberately separate from the selection: arrows
  // move the focus ring, Enter/Space commits it to a selection. Coupling them
  // would open a tab for every row you pass over on the way down.
  const [focusId, setFocusId] = useState<ID | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const typeahead = useRef<{ buf: string; at: number }>({ buf: '', at: 0 })

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

  // Move real DOM focus to follow the roving tabindex — but only when the move
  // came from the keyboard. A click already focuses its own row, and stealing
  // focus on every selection change would yank it out of the editor whenever
  // something else (reveal-in-binder, a new document) moves the selection.
  const wantFocusRef = useRef(false)
  useEffect(() => {
    if (!wantFocusRef.current || !focusId) return
    wantFocusRef.current = false
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(focusId)}"]`)
    if (!el) return
    el.focus()
    el.scrollIntoView({ block: 'nearest' })
  }, [focusId])

  // ⌘⇧B hands the keyboard to the tree (App.tsx dispatches it). Focusing
  // whichever row currently holds the tab stop resumes where the writer was.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const h = () => {
      // Deferred a task: when this comes from the command palette, closing the
      // palette fires `konbini:focus-editor` from an effect right afterwards.
      // Effects run before timers, so this claims focus last and keeps it.
      t = setTimeout(() => {
        const el = scrollRef.current?.querySelector<HTMLElement>('.tree-row[tabindex="0"]')
        if (!el) return
        el.focus()
        el.scrollIntoView({ block: 'nearest' })
      }, 0)
    }
    window.addEventListener('konbini:focus-binder', h)
    return () => { window.removeEventListener('konbini:focus-binder', h); clearTimeout(t) }
  }, [])

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

  // ── Keyboard navigation ──────────────────────────────────────────────────
  //
  // The binder is the primary navigation surface of a keyboard-first app, so it
  // follows the ARIA tree pattern: one tab stop, arrows to move, Enter/Space to
  // act. Focus and selection are separate — see `focusId` above.

  // Where the tab stop sits right now. Falls back to the active node, then the
  // first row, so tabbing in always lands somewhere sensible.
  const focusEff: ID | null =
    (focusId && flat.some((f) => f.id === focusId) ? focusId : null) ??
    (selectedId && flat.some((f) => f.id === selectedId) ? selectedId : null) ??
    flat[0]?.id ?? null

  const focusRow = (id: ID | null | undefined) => {
    if (!id) return
    wantFocusRef.current = true
    setFocusId(id)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    // The rename input lives inside a row; let it have its own keys.
    if (renamingId) return
    // Act on the row that actually holds DOM focus, falling back to the tab
    // stop. The two normally agree, but anything that focuses a row from
    // outside this component would otherwise leave the keys acting on a row
    // the writer can't see a ring around.
    const domId = (e.target as HTMLElement).closest?.('[data-node-id]')?.getAttribute('data-node-id')
    const act: ID | null = (domId && flat.some((f) => f.id === domId) ? domId : null) ?? focusEff
    const i = flat.findIndex((f) => f.id === act)
    const cur = act ? project.nodes[act] : null

    // Move focus, optionally sweeping the selection along with it.
    const step = (to: number, extend: boolean) => {
      const target = flat[Math.max(0, Math.min(flat.length - 1, to))]
      if (!target) return
      focusRow(target.id)
      // selectRange keeps `selectedId` as the anchor, so holding shift keeps
      // growing the same range rather than restarting from each new row.
      if (extend) selectRange(target.id)
    }

    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); step(i + 1, e.shiftKey); return
      case 'ArrowUp':   e.preventDefault(); step(i - 1, e.shiftKey); return
      case 'Home':      e.preventDefault(); step(0, e.shiftKey); return
      case 'End':       e.preventDefault(); step(flat.length - 1, e.shiftKey); return

      case 'ArrowRight':
        e.preventDefault()
        // Closed folder opens; open folder steps into its first child.
        if (cur?.type === 'folder' && !filtering) {
          if (!cur.expanded) void mutate({ type: 'setExpanded', id: cur.id, expanded: true })
          else if (cur.childIds.length) step(i + 1, false)
        }
        return

      case 'ArrowLeft':
        e.preventDefault()
        if (filtering) return
        if (cur?.type === 'folder' && cur.expanded) {
          void mutate({ type: 'setExpanded', id: cur.id, expanded: false })
        } else if (cur?.parentId) {
          focusRow(cur.parentId)
        }
        return

      case 'Enter':
        e.preventDefault()
        if (act) { setFocusId(act); selectNode(act) }
        return

      case ' ':
        // Space would scroll the pane; it's the multi-select key here.
        e.preventDefault()
        if (!act) return
        setFocusId(act)
        if (e.metaKey || e.ctrlKey) toggleSelect(act)
        else selectNode(act)
        return

      case 'F2':
        e.preventDefault()
        if (act) setRenamingId(act)
        return

      case 'Escape':
        // Drop a multi-selection back to just the active node.
        if (useProjectStore.getState().selectedIds.length > 1 && selectedId) {
          e.preventDefault()
          selectNode(selectedId)
        }
        return

      case 'ContextMenu':
        e.preventDefault()
        if (!act) return
        {
          const el = scrollRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(act)}"]`)
          const r = el?.getBoundingClientRect()
          if (!useProjectStore.getState().selectedIds.includes(act)) selectNode(act)
          setCtx({ x: r ? r.left + 24 : 100, y: r ? r.bottom - 4 : 100, id: act })
        }
        return
    }

    // Type-ahead: printable characters jump to the next matching title, the way
    // a file list does. 700ms of silence starts a new search.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now()
      const ta = typeahead.current
      ta.buf = now - ta.at > 700 ? e.key : ta.buf + e.key
      ta.at = now
      const needle = ta.buf.toLowerCase()
      // Start one past the current row so repeating a letter cycles matches.
      const from = ta.buf.length === 1 ? i + 1 : i
      for (let k = 0; k < flat.length; k++) {
        const cand = flat[(from + k + flat.length) % flat.length]
        if (!cand) continue
        if (project.nodes[cand.id]?.title.toLowerCase().startsWith(needle)) {
          e.preventDefault()
          focusRow(cand.id)
          return
        }
      }
    }
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
      // Clicking moves the tab stop, so Tab-ing back in resumes where the
      // writer last was rather than at the top of the manuscript.
      setFocusId(id)
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
      // Grabbing a row outside the selection collapses to it first, the way a
      // file manager does — `actionTargets` already encodes that rule.
      const store = useProjectStore.getState()
      if (!store.selectedIds.includes(id)) selectNode(id)
      const ids = store.selectedIds.includes(id) ? store.actionTargets(id) : [id]
      setDrag({ dragId: id, ids, overId: null, dropPos: null })
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
    // Never offer a drop onto anything being dragged, or inside it.
    if (drag.ids.includes(id)) return
    if (drag.ids.some((d) => isDescendant(project, d, id))) return
    // Measure eagerly, while the event is still live.
    const el = e.currentTarget as HTMLElement | null
    if (!el) return
    const dropPos = calcDropPos(el.getBoundingClientRect(), e.clientY, id)
    setDrag((d) => d ? { ...d, overId: id, dropPos } : d)
  }

  const onDrop = async (e: React.DragEvent, targetId: ID) => {
    e.preventDefault()
    if (!drag || drag.ids.includes(targetId)) { setDrag(null); return }
    const { dropPos } = drag
    const target = project.nodes[targetId]
    if (!target || drag.ids.some((d) => isDescendant(project, d, targetId))) { setDrag(null); return }

    // A folder carries its own children, so moving both would pull a child out
    // of the parent that is already taking it along.
    const moving = drag.ids.filter((id) => !drag.ids.some((other) => other !== id && isDescendant(project, other, id)))

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
    // One move at a time, each landing after the last. The index is re-read
    // from live state between moves rather than incremented: moving a node out
    // of a position before the target shifts every index after it, so counting
    // would scatter the group.
    let index = atIndex
    for (const id of moving) {
      await mutate({ type: 'move', id, newParentId, atIndex: index })
      const proj = useProjectStore.getState().project
      const sibs = newParentId == null ? proj?.rootIds ?? [] : proj?.nodes[newParentId]?.childIds ?? []
      const landed = sibs.indexOf(id)
      index = landed === -1 ? index + 1 : landed + 1
    }
  }

  // Refresh the late-bound refs every render so the stable handler object
  // above always calls the current closures.
  onDragOverRef.current = onDragOver
  onDropRef.current = onDrop
  mutateRef.current = mutate
  renameCommitRef.current = handleRenameCommit

  return (
    <nav className="binder" aria-label="Binder">
      <SidebarResizer edge="right" cssVar="--binder-w" prefKey="pref:binderWidth" min={180} max={480} fallback={264} />
      <div className="binder-hd">Binder</div>
      <BinderFilter />
      <div
        className="binder-scroll"
        ref={scrollRef}
        role="tree"
        aria-label="Binder"
        aria-multiselectable
        onKeyDown={onKeyDown}
      >
        {flat.length === 0 && (
          <div role="none" style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 12.5, lineHeight: 1.6 }}>
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
              focused={focusEff === id}
              level={depth + 1}
              dragging={!!drag?.ids.includes(id)}
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
    </nav>
  )
}
