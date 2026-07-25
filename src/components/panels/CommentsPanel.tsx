import React, { useMemo, useState, useEffect, useRef } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { anchoredFor, excerpt, type AnchoredComment } from '@shared/comments'
import Icon from '../common/Icon'

/**
 * Margin notes for the active document.
 *
 * The rail is a reading surface: every comment shows the prose it points at,
 * and clicking one reveals that span in the editor. Comments whose text has
 * been rewritten away are shown as orphaned rather than silently re-pointed at
 * whatever now sits at those offsets (see shared/comments.ts).
 */
export default function CommentsPanel(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const comments = useProjectStore((s) => s.comments)
  const focusedCommentId = useProjectStore((s) => s.focusedCommentId)
  const setFocusedComment = useProjectStore((s) => s.setFocusedComment)
  const setPendingReveal = useProjectStore((s) => s.setPendingReveal)
  const editComment = useProjectStore((s) => s.editComment)
  const toggleResolved = useProjectStore((s) => s.toggleCommentResolved)
  const deleteComment = useProjectStore((s) => s.deleteComment)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const node = project && selectedId ? project.nodes[selectedId] : null
  const isDoc = !!node && node.type !== 'folder'
  const content = (project && selectedId && project.docs[selectedId]?.content) || ''

  const all = useMemo(
    () => (isDoc && selectedId ? anchoredFor(comments, selectedId, content) : []),
    [comments, selectedId, content, isDoc],
  )
  const resolvedCount = all.filter((c) => c.resolved).length
  const shown = showResolved ? all : all.filter((c) => !c.resolved)

  // Scroll a comment into view when the editor asks for it (span clicked).
  useEffect(() => {
    if (!focusedCommentId) return
    const el = listRef.current?.querySelector(`[data-cid="${focusedCommentId}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    // A newly created comment opens straight into its editor.
    const target = all.find((c) => c.id === focusedCommentId)
    if (target && !target.body) { setEditingId(target.id); setDraft('') }
  }, [focusedCommentId, all])

  const reveal = (c: AnchoredComment) => {
    setFocusedComment(c.id)
    if (c.orphaned || !selectedId) return
    setPendingReveal({ docId: selectedId, from: c.live.from, len: c.live.to - c.live.from })
  }

  const startEdit = (c: AnchoredComment) => { setEditingId(c.id); setDraft(c.body) }

  const commitEdit = (id: string) => {
    const body = draft.trim()
    // An empty body means the note was never written — drop it rather than
    // leaving a highlight with nothing behind it.
    if (!body) deleteComment(id)
    else editComment(id, body)
    setEditingId(null)
    setDraft('')
  }

  if (!isDoc) {
    return (
      <div className="dock-panel">
        <div className="dock-hd"><h3>Comments</h3></div>
        <div className="dock-body dock-empty">Select a document to see its comments.</div>
      </div>
    )
  }

  return (
    <div className="dock-panel">
      <div className="dock-hd">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>Comments</h3>
          <span className="sub"> · {all.length - resolvedCount} open</span>
        </div>
        {resolvedCount > 0 && (
          <button
            className={`chip${showResolved ? ' on' : ''}`}
            onClick={() => setShowResolved((v) => !v)}
            title={showResolved ? 'Hide resolved comments' : 'Show resolved comments'}
          >
            {resolvedCount} resolved
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="dock-body dock-empty">
          {all.length === 0
            ? 'Select some text and press ⌘⇧M to leave yourself a note.'
            : 'No open comments. Every note on this document is resolved.'}
        </div>
      ) : (
        <div className="dock-body cmt-list" ref={listRef}>
          {shown.map((c) => (
            <div
              key={c.id}
              data-cid={c.id}
              className={`cmt${c.resolved ? ' done' : ''}${c.orphaned ? ' orphan' : ''}${focusedCommentId === c.id ? ' focus' : ''}`}
              onClick={() => reveal(c)}
            >
              <div className="cmt-quote">
                {c.orphaned
                  ? <span className="cmt-orphan-note">detached — “{excerpt(c.anchor.quote, 40)}” is gone</span>
                  : excerpt(c.anchor.quote)}
              </div>

              {editingId === c.id ? (
                <textarea
                  className="cmt-input"
                  autoFocus
                  value={draft}
                  placeholder="What's the note?"
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => commitEdit(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitEdit(c.id) }
                    if (e.key === 'Escape') { e.preventDefault(); setEditingId(null); setDraft('') }
                  }}
                />
              ) : (
                <div className="cmt-body" onDoubleClick={(e) => { e.stopPropagation(); startEdit(c) }}>
                  {c.body}
                </div>
              )}

              <div className="cmt-foot">
                <span className={`cmt-who${c.origin === 'ai' ? ' ai' : ''}`}>{c.author}</span>
                <span style={{ flex: 1 }} />
                <button
                  className="cmt-act"
                  title={c.resolved ? 'Reopen' : 'Resolve'}
                  aria-label={c.resolved ? 'Reopen comment' : 'Resolve comment'}
                  onClick={(e) => { e.stopPropagation(); toggleResolved(c.id) }}
                ><Icon name={c.resolved ? 'undo' : 'check'} size={13} /></button>
                <button
                  className="cmt-act"
                  title="Edit"
                  aria-label="Edit comment"
                  onClick={(e) => { e.stopPropagation(); startEdit(c) }}
                ><Icon name="edit" size={13} /></button>
                <button
                  className="cmt-act"
                  title="Delete"
                  aria-label="Delete comment"
                  onClick={(e) => { e.stopPropagation(); deleteComment(c.id) }}
                ><Icon name="trash" size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
