import React, { useEffect, useState, useMemo } from 'react'
import { useProjectStore } from '../../store/projectStore'
import ContextMenu from '../common/ContextMenu'
import Icon from '../common/Icon'
import type { Snapshot } from '@shared/types'

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = ms / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yest = new Date(); yest.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yest.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function lineDiff(a: string, b: string): Array<{ t: 'ctx' | 'add' | 'del'; v: string }> {
  const aLines = a.split('\n'), bLines = b.split('\n')
  const result: Array<{ t: 'ctx' | 'add' | 'del'; v: string }> = []
  const m = aLines.length, n = bLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  let i = 0, j = 0
  while (i < m || j < n) {
    if (i < m && j < n && aLines[i] === bLines[j]) { result.push({ t: 'ctx', v: aLines[i] }); i++; j++ }
    else if (j < n && (i >= m || dp[i + 1]?.[j] <= dp[i]?.[j + 1])) { result.push({ t: 'add', v: bLines[j] }); j++ }
    else { result.push({ t: 'del', v: aLines[i] }); i++ }
  }
  return result
}

type Filter = 'all' | 'manual' | 'auto'

interface Props { onClose: () => void }

export default function HistoryModal({ onClose }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const addSnapshot = useProjectStore((s) => s.addSnapshot)
  const removeSnapshot = useProjectStore((s) => s.removeSnapshot)
  const restoreContent = useProjectStore((s) => s.restoreContent)

  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [selected, setSelected] = useState<Snapshot | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [restoring, setRestoring] = useState(false)
  const [taking, setTaking] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<{ type: 'restore' | 'delete'; snap: Snapshot } | null>(null)
  const [compareMode, setCompareMode] = useState<'current' | 'previous'>('current')
  const [ctx, setCtx] = useState<{ x: number; y: number; snap: Snapshot } | null>(null)

  const nodeId = selectedId
  const node = nodeId && project ? project.nodes[nodeId] : null

  useEffect(() => {
    if (!project || !nodeId || node?.type === 'folder') return
    window.api.snapshot.list(project.id, nodeId).then(setSnapshots).catch((e: Error) => setError(e.message))
  }, [nodeId, project?.id])

  const currentContent = project && nodeId ? (project.docs[nodeId]?.content ?? '') : ''

  const visible = useMemo(
    () => snapshots.filter((s) => filter === 'all' ? true : (s.kind ?? 'manual') === filter),
    [snapshots, filter]
  )

  if (!project || !nodeId || !node || node.type === 'folder') {
    return (
      <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-label="Document History">
          <div className="modal-hd"><h3>Document History</h3></div>
          <div className="modal-body dock-empty" style={{ padding: 'var(--s4) var(--s5)' }}>Select a document first.</div>
          <div className="modal-foot"><span className="tb-spacer" /><button className="btn" onClick={onClose}>Close</button></div>
        </div>
      </div>
    )
  }

  const handleTake = async () => {
    setTaking(true)
    try {
      const snap = await window.api.snapshot.take(project.id, nodeId, newTitle.trim() || undefined)
      addSnapshot(nodeId, snap)
      setSnapshots((prev) => [snap, ...prev])
      setNewTitle('')
    } catch (e) {
      setError('Snapshot could not be taken: ' + (e as Error).message)
    } finally {
      setTaking(false)
    }
  }

  const handleRestore = (snap: Snapshot) => setConfirming({ type: 'restore', snap })
  const handleDelete = (snap: Snapshot) => setConfirming({ type: 'delete', snap })

  const handleConfirm = async () => {
    if (!confirming) return
    const { type, snap } = confirming
    setConfirming(null)
    if (type === 'restore') {
      setRestoring(true)
      try {
        const { content, snapshot } = await window.api.snapshot.restore(project.id, nodeId, snap.id)
        restoreContent(nodeId, content)
        addSnapshot(nodeId, snapshot)
        setSnapshots((prev) => [snapshot, ...prev])
        onClose()
      } catch (e) {
        setError('Restore failed: ' + (e as Error).message)
      } finally {
        setRestoring(false)
      }
    } else {
      try {
        await window.api.snapshot.delete(project.id, nodeId, snap.id)
        removeSnapshot(nodeId, snap.id)
        setSnapshots((prev) => prev.filter((s) => s.id !== snap.id))
        if (selected?.id === snap.id) setSelected(null)
      } catch (e) {
        setError('Delete failed: ' + (e as Error).message)
      }
    }
  }

  // Compare endpoints. 'current' diffs the selected version against the live
  // document; 'previous' diffs the version immediately older than it against
  // it — i.e. what THIS version changed. `snapshots` is newest-first, so the
  // predecessor is the next index after the selected one.
  const selectedIdx = selected ? snapshots.findIndex((s) => s.id === selected.id) : -1
  const predecessor = selectedIdx >= 0 ? snapshots[selectedIdx + 1] : undefined
  const effectiveMode: 'current' | 'previous' = compareMode === 'previous' && predecessor ? 'previous' : 'current'

  const oldEnd = effectiveMode === 'previous' ? predecessor : selected
  const newEnd = effectiveMode === 'previous' ? selected : null   // null = current document
  const oldContent = oldEnd?.content ?? ''
  const newContent = newEnd ? newEnd.content : currentContent
  const oldWords = oldEnd ? oldEnd.words : 0
  const newWords = newEnd ? newEnd.words : (currentContent.trim() ? currentContent.trim().split(/\s+/).length : 0)
  const oldLabel = oldEnd ? relTime(oldEnd.takenAt) : '—'
  const newLabel = newEnd ? relTime(newEnd.takenAt) : 'current'

  const diff = selected ? lineDiff(oldContent, newContent) : []

  // Group visible versions by calendar day for the timeline.
  const groups: Array<{ label: string; items: Snapshot[] }> = []
  for (const s of visible) {
    const label = dayLabel(s.takenAt)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(s)
    else groups.push({ label, items: [s] })
  }

  const chip = (f: Filter, text: string) => (
    <button className={`chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>{text}</button>
  )

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Document History">
        <div className="modal-hd" style={{ alignItems: 'baseline', gap: 10 }}>
          <h3>Document History</h3>
          <span className="sub">{node.title}</span>
          <span className="tb-spacer" />
          <div style={{ display: 'flex', gap: 'var(--s2)' }}>
            {chip('all', 'All')}
            {chip('manual', 'Manual')}
            {chip('auto', 'Auto')}
          </div>
        </div>
        <div className="modal-body hist-body">
          {/* Left: timeline */}
          <div className="hist-timeline">
            <div className="hist-take">
              <input
                className="inp"
                style={{ flex: 1 }}
                placeholder="Snapshot name (optional)"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !taking) handleTake() }}
              />
              <button className="btn sm" disabled={taking} onClick={handleTake}>
                {taking ? '…' : '+ Take Snapshot'}
              </button>
            </div>
            {error && (
              <div role="alert" className="hist-banner err">
                <span style={{ color: 'var(--st-idea)', display: 'flex' }}><Icon name="warning" size={14} /></span>
                <span style={{ flex: 1, color: 'var(--text)' }}>{error}</span>
                <button className="hist-banner-x" onClick={() => setError(null)}><Icon name="x" size={14} /></button>
              </div>
            )}
            {confirming && (
              <div className="hist-banner">
                <span style={{ flex: 1, color: 'var(--text-2)' }}>
                  {confirming.type === 'restore'
                    ? `Restore to version from ${relTime(confirming.snap.takenAt)}? Current text will be auto-saved to history first.`
                    : 'Delete this version permanently? This cannot be undone.'}
                </span>
                <button className="btn sm" onClick={handleConfirm}>{confirming.type === 'restore' ? 'Restore' : 'Delete'}</button>
                <button className="btn sm ghost" onClick={() => setConfirming(null)}>Cancel</button>
              </div>
            )}
            {visible.length === 0 && (
              <div className="hist-empty">
                No versions yet. They accrue automatically as you write, or take a manual snapshot.
              </div>
            )}
            {groups.map((g) => (
              <div key={g.label}>
                <div className="hist-day">{g.label}</div>
                {g.items.map((snap) => {
                  const isAuto = (snap.kind ?? 'manual') === 'auto'
                  return (
                    <div
                      key={snap.id}
                      className={`snap-item${selected?.id === snap.id ? ' sel' : ''}`}
                      onClick={() => setSelected(snap)}
                      onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, snap }) }}
                    >
                      <div className="si-main">
                        <div className="si-t" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className={`snap-tag${isAuto ? ' auto' : ''}`}>{isAuto ? 'Auto' : 'Saved'}</span>
                          {snap.title || (isAuto ? 'Version' : 'Snapshot')}
                        </div>
                        <div className="si-m">{relTime(snap.takenAt)} · {snap.words} words</div>
                      </div>
                      <button className="btn sm" disabled={restoring} onClick={(e) => { e.stopPropagation(); handleRestore(snap) }}>{restoring ? '…' : 'Restore'}</button>
                      <button className="btn sm danger" onClick={(e) => { e.stopPropagation(); handleDelete(snap) }}><Icon name="x" size={13} /></button>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {/* Right: diff preview */}
          <div>
            {selected && (
              <div className="hist-cmp">
                <button className={`chip${effectiveMode === 'current' ? ' on' : ''}`} onClick={() => setCompareMode('current')}>vs. current</button>
                <button
                  className={`chip${effectiveMode === 'previous' ? ' on' : ''}`}
                  onClick={() => setCompareMode('previous')}
                  disabled={!predecessor}
                  title={predecessor ? 'Compare with the previous version' : 'This is the oldest version'}
                >vs. previous</button>
              </div>
            )}
            <div className="hist-range">
              {selected
                ? `${oldLabel} (${oldWords}w) → ${newLabel} (${newWords}w)`
                : 'Select a version to compare with the current text'}
            </div>
            {selected && (
              <div className="snap-diff">
                {diff.map((line, i) => (
                  <div key={i} className={line.t === 'add' ? 'add' : line.t === 'del' ? 'del' : ''}>
                    {line.t === 'add' ? '+ ' : line.t === 'del' ? '- ' : '  '}{line.v}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="modal-foot">
          <span className="hint">
            {snapshots.length} version{snapshots.length !== 1 ? 's' : ''} · auto-saved as you write
          </span>
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          items={[
            { label: 'Compare with current', action: () => { setSelected(ctx.snap); setCompareMode('current') } },
            {
              label: 'Compare with previous',
              action: () => { setSelected(ctx.snap); setCompareMode('previous') },
              disabled: snapshots.findIndex((s) => s.id === ctx.snap.id) >= snapshots.length - 1,
            },
            { label: 'Restore this version', action: () => handleRestore(ctx.snap) },
            { label: '---', action: () => {} },
            { label: 'Delete version', action: () => handleDelete(ctx.snap), danger: true },
          ]}
          onClose={() => setCtx(null)}
        />
      )}
    </div>
  )
}
