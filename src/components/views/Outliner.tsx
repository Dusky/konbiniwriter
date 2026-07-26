import React, { useState } from 'react'
import { setNodeDrag } from '../../lib/nodeDnd'
import { useProjectStore, flattenVisible } from '../../store/projectStore'
import { STATUS_META, LABEL_META, wordCount } from '@shared/utils'
import ContextMenu from '../common/ContextMenu'
import Icon from '../common/Icon'
import { useNodeMenu } from '../common/useNodeMenu'

export default function Outliner(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const selectNode = useProjectStore((s) => s.selectNode)
  const setView = useProjectStore((s) => s.setView)
  const nodeMenu = useNodeMenu()
  const [ctx, setCtx] = useState<{ x: number; y: number; id: string } | null>(null)

  if (!project) return <div className="main" />

  const flat = flattenVisible(project)

  if (flat.length === 0) {
    return (
      <div className="main">
        <div className="outl" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-3)', fontSize: 13 }}>
          No documents here yet. Add some from the Binder.
        </div>
      </div>
    )
  }

  return (
    <div className="main">
      <div className="outl">
        <table className="otable">
          <thead>
            <tr>
              <th style={{ width: '35%' }}>Title</th>
              <th>Synopsis</th>
              <th style={{ width: 80 }}>Words</th>
              <th style={{ width: 110 }}>Status</th>
              <th style={{ width: 90 }}>Label</th>
            </tr>
          </thead>
          <tbody>
            {flat.map(({ id, depth }) => {
              const node = project.nodes[id]
              if (!node) return null
              const words = node.type !== 'folder' ? wordCount(project.docs[id]?.content ?? '') : null
              const status = STATUS_META[node.meta.status]
              const label = LABEL_META[node.meta.label]

              return (
                <tr
                  key={id}
                  className={selectedId === id ? 'sel' : ''}
                  draggable
                  onDragStart={(e) => setNodeDrag(e.dataTransfer, id)}
                  onClick={() => selectNode(id)}
                  onDoubleClick={() => { selectNode(id); if (node.type !== 'folder') setView('editor') }}
                  onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, id }) }}
                >
                  <td>
                    <div className="o-title" style={{ paddingLeft: depth * 16 }}>
                      <Icon name={node.type === 'folder' ? 'folder' : node.type === 'scene' ? 'document' : 'sticky-note'} />
                      {node.title}
                    </div>
                  </td>
                  <td className="o-syn">{node.meta.synopsis}</td>
                  <td className="num">{words != null ? words.toLocaleString() : '—'}</td>
                  <td>
                    {node.type !== 'folder' && (
                      <span className="badge">
                        <span className="dot" style={{ background: status.color }} />
                        {status.label}
                      </span>
                    )}
                  </td>
                  <td>
                    {node.meta.label !== 'none' && (
                      <span className="badge">
                        <span className="dot" style={{ background: label.color }} />
                        {label.label}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {ctx && (
        <ContextMenu x={ctx.x} y={ctx.y} items={nodeMenu(ctx.id)} onClose={() => setCtx(null)} />
      )}
    </div>
  )
}
