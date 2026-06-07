import React, { useEffect, useState } from 'react'
import { useProjectStore } from '../../store/projectStore'
import type { Snapshot } from '@shared/types'

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = ms / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function lineDiff(a: string, b: string): Array<{ t: 'ctx' | 'add' | 'del'; v: string }> {
  const aLines = a.split('\n')
  const bLines = b.split('\n')
  const result: Array<{ t: 'ctx' | 'add' | 'del'; v: string }> = []
  const maxCtx = 3
  // Simple LCS-based diff — good enough for preview
  const m = aLines.length, n = bLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = aLines[i] === bLines[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j], dp[i][j+1])
  let i = 0, j = 0
  while (i < m || j < n) {
    if (i < m && j < n && aLines[i] === bLines[j]) { result.push({ t: 'ctx', v: aLines[i] }); i++; j++ }
    else if (j < n && (i >= m || dp[i+1]?.[j] <= dp[i]?.[j+1])) { result.push({ t: 'add', v: bLines[j] }); j++ }
    else { result.push({ t: 'del', v: aLines[i] }); i++ }
  }
  return result
}

interface Props { onClose: () => void }

export default function SnapshotModal({ onClose }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const addSnapshot = useProjectStore((s) => s.addSnapshot)
  const removeSnapshot = useProjectStore((s) => s.removeSnapshot)
  const restoreContent = useProjectStore((s) => s.restoreContent)
  const updateContent = useProjectStore((s) => s.updateContent)

  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [selectedSnap, setSelectedSnap] = useState<Snapshot | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [taking, setTaking] = useState(false)

  const nodeId = selectedId
  const node = nodeId && project ? project.nodes[nodeId] : null

  useEffect(() => {
    if (!project || !nodeId || node?.type === 'folder') return
    window.api.snapshot.list(project.id, nodeId).then(setSnapshots).catch(console.error)
  }, [nodeId, project?.id])

  if (!project || !nodeId || !node || node.type === 'folder') {
    return (
      <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal" style={{ maxWidth: 560 }}>
          <div className="modal-hd"><h3>Snapshots</h3></div>
          <div className="modal-body" style={{ color: 'var(--text-3)' }}>Select a document first.</div>
          <div className="modal-foot"><span className="tb-spacer" /><button className="btn" onClick={onClose}>Close</button></div>
        </div>
      </div>
    )
  }

  const currentContent = project.docs[nodeId]?.content ?? ''

  const handleTake = async () => {
    setTaking(true)
    try {
      const snap = await window.api.snapshot.take(project.id, nodeId, newTitle.trim() || undefined)
      addSnapshot(nodeId, snap)
      setSnapshots((prev) => [snap, ...prev])
      setNewTitle('')
    } finally {
      setTaking(false)
    }
  }

  const handleRestore = async (snap: Snapshot) => {
    if (!confirm(`Restore to snapshot "${snap.title || snap.takenAt}"? Current content will be auto-snapshotted first.`)) return
    const { content, snapshot } = await window.api.snapshot.restore(project.id, nodeId, snap.id)
    restoreContent(nodeId, content)
    addSnapshot(nodeId, snapshot)
    setSnapshots((prev) => [snapshot, ...prev])
    onClose()
  }

  const handleDelete = async (snap: Snapshot) => {
    if (!confirm('Delete this snapshot permanently?')) return
    await window.api.snapshot.delete(project.id, nodeId, snap.id)
    removeSnapshot(nodeId, snap.id)
    setSnapshots((prev) => prev.filter((s) => s.id !== snap.id))
    if (selectedSnap?.id === snap.id) setSelectedSnap(null)
  }

  const diff = selectedSnap ? lineDiff(selectedSnap.content, currentContent) : []

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-hd">
          <h3>Snapshots</h3>
          <span className="sub">{node.title}</span>
        </div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minHeight: 320 }}>
          {/* Left: list */}
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                className="inp"
                placeholder="Snapshot name (optional)"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleTake()}
                style={{ flex: 1 }}
              />
              <button className="btn primary sm" onClick={handleTake} disabled={taking}>
                {taking ? '…' : 'Take'}
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
              {snapshots.length === 0 && (
                <div style={{ color: 'var(--text-3)', fontSize: 12, padding: '12px 0' }}>No snapshots yet.</div>
              )}
              {snapshots.map((snap) => (
                <div
                  key={snap.id}
                  className={`snap-item${selectedSnap?.id === snap.id ? ' sel' : ''}`}
                  onClick={() => setSelectedSnap(snap)}
                >
                  <div className="si-main">
                    <div className="si-t">{snap.title || 'Snapshot'}</div>
                    <div className="si-m">{relTime(snap.takenAt)} · {snap.words} words</div>
                  </div>
                  <button className="btn sm" onClick={(e) => { e.stopPropagation(); handleRestore(snap) }}>Restore</button>
                  <button className="btn sm danger" onClick={(e) => { e.stopPropagation(); handleDelete(snap) }}>✕</button>
                </div>
              ))}
            </div>
          </div>

          {/* Right: diff preview */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>
              {selectedSnap ? `Diff: snapshot → current` : 'Select a snapshot to preview diff'}
            </div>
            {selectedSnap && (
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
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
