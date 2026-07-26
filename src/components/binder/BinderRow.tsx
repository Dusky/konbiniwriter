import React from 'react'
import Icon from '../common/Icon'
import { fmtWords } from '@shared/utils'
import type { ID, NodeType } from '@shared/types'

type DropPos = 'before' | 'into' | 'after'

/**
 * Callbacks shared by every row. Deliberately one stable object taking the id
 * per call, rather than per-row closures: a fresh closure per row per render
 * would defeat the memo below entirely.
 */
export interface RowHandlers {
  onClick: (id: ID, e: React.MouseEvent) => void
  onContextMenu: (id: ID, e: React.MouseEvent) => void
  onDragStart: (id: ID, e: React.DragEvent) => void
  onDragOver: (id: ID, e: React.DragEvent) => void
  onDrop: (id: ID, e: React.DragEvent) => void
  onDragEnd: () => void
  onToggleExpand: (id: ID, expanded: boolean) => void
  onRenameChange: (v: string) => void
  onRenameCommit: (id: ID, v: string) => void
  onRenameCancel: () => void
}

export interface BinderRowProps {
  id: ID
  depth: number
  title: string
  type: NodeType
  expanded: boolean
  words: number
  statusColor: string
  status: string
  selected: boolean
  current: boolean
  dragging: boolean
  isOver: boolean
  dropPos: DropPos | null
  filtering: boolean
  renaming: boolean
  /** Only meaningful while `renaming`; undefined otherwise so memo stays stable. */
  renameValue?: string
  renameInputRef?: React.Ref<HTMLInputElement>
  h: RowHandlers
}

/**
 * One binder row.
 *
 * Memoised on purpose. Typing replaces the `project` object identity, so the
 * binder re-renders on every keystroke; without this, all 300+ rows reconcile
 * each time. Measured at ~0.18ms per row, which is ~54ms per keypress on a
 * 300-node project — the difference between a responsive editor and a laggy
 * one. Every prop here is a primitive, so React's shallow compare does the
 * right thing and only genuinely changed rows re-render.
 */
function BinderRowInner(p: BinderRowProps): React.ReactElement {
  const { id, h } = p
  return (
    <>
      {p.isOver && p.dropPos === 'before' && <div className="drop-line" />}
      <div
        data-node-id={id}
        className={`tree-row${p.selected ? ' sel' : ''}${p.current ? ' cur' : ''}${p.isOver && p.dropPos === 'into' ? ' drop-into' : ''}`}
        style={{ paddingLeft: `${p.depth * 15 + 4}px`, opacity: p.dragging ? 0.4 : 1 }}
        onClick={(e) => h.onClick(id, e)}
        onContextMenu={(e) => h.onContextMenu(id, e)}
        draggable={!p.filtering}
        onDragStart={(e) => h.onDragStart(id, e)}
        onDragOver={(e) => h.onDragOver(id, e)}
        onDrop={(e) => h.onDrop(id, e)}
        onDragEnd={h.onDragEnd}
      >
        {/* Expand twist for folders */}
        {p.type === 'folder' && !p.filtering ? (
          <span
            className={`tw-twist${p.expanded ? ' open' : ''}`}
            onClick={(e) => { e.stopPropagation(); h.onToggleExpand(id, !p.expanded) }}
          >
            <svg viewBox="0 0 9 9" fill="currentColor"><path d="M2 1l5 3.5L2 8z" /></svg>
          </span>
        ) : (
          <span className="tw-twist" />
        )}

        <span className="tw-icon">
          <Icon name={p.type === 'folder' ? 'folder' : p.type === 'scene' ? 'document' : 'edit'} />
        </span>

        <span className="tw-label">
          {p.renaming ? (
            <input
              ref={p.renameInputRef}
              value={p.renameValue ?? ''}
              onChange={(e) => h.onRenameChange(e.target.value)}
              onBlur={() => h.onRenameCommit(id, p.renameValue ?? '')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') h.onRenameCommit(id, p.renameValue ?? '')
                if (e.key === 'Escape') h.onRenameCancel()
                e.stopPropagation()
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            p.title
          )}
        </span>

        {p.words > 0 && <span className="tw-count">{fmtWords(p.words)}</span>}

        {p.type !== 'folder' && (
          <span className="tw-status" style={{ background: p.statusColor }} title={p.status} />
        )}
      </div>
      {p.isOver && p.dropPos === 'after' && <div className="drop-line" />}
    </>
  )
}

export default React.memo(BinderRowInner)
