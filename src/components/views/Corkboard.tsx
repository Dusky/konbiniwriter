import React from 'react'
import { useProjectStore } from '../../store/projectStore'
import { STATUS_META, LABEL_META, wordCount } from '@shared/utils'

export default function Corkboard(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const selectNode = useProjectStore((s) => s.selectNode)
  const setView = useProjectStore((s) => s.setView)
  const updateMeta = useProjectStore((s) => s.updateMeta)
  const applyMutation = useProjectStore((s) => s.applyMutation)

  if (!project) return <div className="main" />

  // Show children of selected folder, or root nodes if none selected
  const parentId = selectedId && project.nodes[selectedId]?.type === 'folder' ? selectedId : null
  const childIds = parentId ? project.nodes[parentId]?.childIds ?? [] : project.rootIds

  const handleSynopsisChange = async (nodeId: string, synopsis: string) => {
    updateMeta(nodeId, { synopsis })
    const result = await window.api.node.mutate(project.id, { type: 'updateMeta', id: nodeId, patch: { synopsis } })
    applyMutation(result)
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

            return (
              <div
                key={id}
                className={`card${selectedId === id ? ' sel' : ''}`}
                style={{ '--card-label': labelColor } as React.CSSProperties}
                onClick={() => selectNode(id)}
                onDoubleClick={() => { selectNode(id); setView('editor') }}
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
    </div>
  )
}
