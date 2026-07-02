import React, { useRef, useState } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
import { STATUS_META, LABEL_META, wordCount } from '@shared/utils'
import ContextMenu from '../common/ContextMenu'
import { useNodeMenu } from '../common/useNodeMenu'

export default function Corkboard(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const selectNode = useProjectStore((s) => s.selectNode)
  const setView = useProjectStore((s) => s.setView)
  const updateMeta = useProjectStore((s) => s.updateMeta)
  const applyMutation = useProjectStore((s) => s.applyMutation)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nodeMenu = useNodeMenu()
  const [ctx, setCtx] = useState<{ x: number; y: number; id: string } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  // Index in childIds the dragged card would land at; 'after' renders the bar
  // on the card's right edge.
  const [dropAt, setDropAt] = useState<{ overId: string; after: boolean } | null>(null)

  if (!project) return <div className="main" />

  // Show children of selected folder, or root nodes if none selected
  const parentId = selectedId && project.nodes[selectedId]?.type === 'folder' ? selectedId : null
  const childIds = parentId ? project.nodes[parentId]?.childIds ?? [] : project.rootIds

  const handleSynopsisChange = (nodeId: string, synopsis: string) => {
    updateMeta(nodeId, { synopsis })
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await window.api.node.mutate(project.id, { type: 'updateMeta', id: nodeId, patch: { synopsis } })
        applyMutation(result)
      } catch (e) {
        useShellStore.getState().setToast('Synopsis could not be saved: ' + (e as Error).message)
      }
    }, 400)
  }

  const handleDrop = async () => {
    if (!dragId || !dropAt || dropAt.overId === dragId) { setDragId(null); setDropAt(null); return }
    const targetIdx = childIds.indexOf(dropAt.overId)
    if (targetIdx === -1) { setDragId(null); setDropAt(null); return }
    let atIndex = dropAt.after ? targetIdx + 1 : targetIdx
    // Removing the dragged card from earlier in the list shifts the target left.
    const fromIdx = childIds.indexOf(dragId)
    if (fromIdx !== -1 && fromIdx < atIndex) atIndex--
    const id = dragId
    setDragId(null); setDropAt(null)
    try {
      const result = await window.api.node.mutate(project.id, { type: 'move', id, newParentId: parentId, atIndex })
      applyMutation(result)
    } catch (e) {
      useShellStore.getState().setToast('Move could not be saved: ' + (e as Error).message)
    }
  }

  return (
    <div className="main">
      <div className="cork">
        <div className="cork-grid">
          {childIds.map((id) => {
            const node = project.nodes[id]
            if (!node) return null
            const labelColor = LABEL_META[node.meta.label]?.color ?? 'transparent'
            const statusColor = STATUS_META[node.meta.status]?.color ?? 'var(--text-3)'
            const words = wordCount(project.docs[id]?.content ?? '')
            const isDrop = dropAt?.overId === id && dragId && dragId !== id

            return (
              <div
                key={id}
                className={`card${selectedId === id ? ' sel' : ''}`}
                style={{
                  '--card-label': labelColor,
                  opacity: dragId === id ? 0.4 : 1,
                  boxShadow: isDrop
                    ? `${dropAt!.after ? '' : '-'}3px 0 0 0 var(--accent)`
                    : undefined,
                } as React.CSSProperties}
                draggable
                onDragStart={() => setDragId(id)}
                onDragEnd={() => { setDragId(null); setDropAt(null) }}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (!dragId || dragId === id) return
                  const rect = e.currentTarget.getBoundingClientRect()
                  setDropAt({ overId: id, after: e.clientX > rect.left + rect.width / 2 })
                }}
                onDrop={(e) => { e.preventDefault(); handleDrop() }}
                onClick={() => selectNode(id)}
                onDoubleClick={() => { selectNode(id); setView('editor') }}
                onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, id }) }}
              >
                <div className="pin" />
                <div className="ct">
                  <div className="t">{node.title}</div>
                  <span className="st" style={{ background: statusColor }} title={node.meta.status} />
                </div>
                <textarea
                  className="cs"
                  placeholder="Synopsis…"
                  value={node.meta.synopsis}
                  onChange={(e) => handleSynopsisChange(id, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
                <div className="cf">
                  <span>{node.type}</span>
                  {words > 0 && <span style={{ marginLeft: 'auto' }}>{words} words</span>}
                </div>
              </div>
            )
          })}
          {childIds.length === 0 && (
            <div style={{ color: 'var(--text-3)', gridColumn: '1/-1', textAlign: 'center', padding: '60px 0', fontSize: 13 }}>
              No documents here yet. Add some from the Binder.
            </div>
          )}
        </div>
      </div>
      {ctx && (
        <ContextMenu x={ctx.x} y={ctx.y} items={nodeMenu(ctx.id)} onClose={() => setCtx(null)} />
      )}
    </div>
  )
}
