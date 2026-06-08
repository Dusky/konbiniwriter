import React, { useEffect, useState, useMemo } from 'react'
import { useProjectStore } from '../../store/projectStore'
import ContextMenu from '../common/ContextMenu'
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
  const [ctx, setCtx] = useState<{ x: number; y: number; snap: Snapshot } | null>(null)

  const nodeId = selectedId
  const node = nodeId && project ? project.nodes[nodeId] : null

  useEffect(() => {
    if (!project || !nodeId || node?.type === 'folder') return
    window.api.snapshot.list(project.id, nodeId).then(setSnapshots).catch(console.error)
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
          <div className="modal-body" style={{ color: 'var(--text-3)' }}>Select a document first.</div>
          <div className="modal-foot"><span className="tb-spacer" /><button className="btn" onClick={onClose}>Close</button></div>
        </div>
      </div>
    )
  }

  const handleRestore = async (snap: Snapshot) => {
    if (!confirm(`Restore the version from ${relTime(snap.takenAt)}? The current text is auto-saved to history first.`)) return
    setRestoring(true)
    try {
      const { content, snapshot } = await window.api.snapshot.restore(project.id, nodeId, snap.id)
      restoreContent(nodeId, content)
      addSnapshot(nodeId, snapshot)
      setSnapshots((prev) => [snapshot, ...prev])
      onClose()
    } catch (e) {
      alert('Restore failed: ' + (e as Error).message)
    } finally {
      setRestoring(false)
    }
  }

  const handleDelete = async (snap: Snapshot) => {
    if (!confirm('Delete this version permanently?')) return
    await window.api.snapshot.delete(project.id, nodeId, snap.id)
    removeSnapshot(nodeId, snap.id)
    setSnapshots((prev) => prev.filter((s) => s.id !== snap.id))
    if (selected?.id === snap.id) setSelected(null)
  }

  const diff = selected ? lineDiff(selected.content, currentContent) : []
  const curWords = currentContent.trim() ? currentContent.trim().split(/\s+/).length : 0

  // Group visible versions by calendar day for the timeline.
  const groups: Array<{ label: string; items: Snapshot[] }> = []
  for (const s of visible) {
    const label = dayLabel(s.takenAt)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(s)
    else groups.push({ label, items: [s] })
  }

  const chip = (f: Filter, text: string) => (
    <button
      onClick={() => setFilter(f)}
      style={{
        padding: '2px 10px', borderRadius: 999, fontSize: 11, cursor: 'pointer',
        border: '1px solid var(--border-2)',
        background: filter === f ? 'var(--accent-soft)' : 'transparent',
        color: filter === f ? 'var(--text)' : 'var(--text-3)',
      }}
    >{text}</button>
  )

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Document History">
        <div className="modal-hd" style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h3>Document History</h3>
          <span className="sub">{node.title}</span>
          <span className="tb-spacer" />
          <div style={{ display: 'flex', gap: 6 }}>
            {chip('all', 'All')}
            {chip('manual', 'Manual')}
            {chip('auto', 'Auto')}
          </div>
        </div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minHeight: 340 }}>
          {/* Left: timeline */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 400, overflowY: 'auto' }}>
            {visible.length === 0 && (
              <div style={{ color: 'var(--text-3)', fontSize: 12, padding: '12px 0' }}>
                No versions yet. They accrue automatically as you write, or take a manual snapshot.
              </div>
            )}
            {groups.map((g) => (
              <div key={g.label}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', margin: '8px 0 4px' }}>
                  {g.label}
                </div>
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
                          <span style={{
                            fontSize: 9, padding: '1px 5px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: '0.04em',
                            background: isAuto ? 'var(--bg-3)' : 'var(--accent-soft)',
                            color: isAuto ? 'var(--text-3)' : 'var(--text)',
                          }}>{isAuto ? 'Auto' : 'Saved'}</span>
                          {snap.title || (isAuto ? 'Version' : 'Snapshot')}
                        </div>
                        <div className="si-m">{relTime(snap.takenAt)} · {snap.words} words</div>
                      </div>
                      <button className="btn sm" disabled={restoring} onClick={(e) => { e.stopPropagation(); handleRestore(snap) }}>{restoring ? '…' : 'Restore'}</button>
                      <button className="btn sm danger" onClick={(e) => { e.stopPropagation(); handleDelete(snap) }}>✕</button>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {/* Right: diff preview */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>
              {selected
                ? `This version (${selected.words}w) → current (${curWords}w)`
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
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
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
            { label: 'Compare with current', action: () => setSelected(ctx.snap) },
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
