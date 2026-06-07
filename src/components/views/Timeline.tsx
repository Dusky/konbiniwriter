import React, { useState } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { STATUS_META, wordCount } from '@shared/utils'
import type { ID } from '@shared/types'

interface Row {
  folderId: ID | null
  folderTitle: string
  sceneIds: ID[]
}

function buildRows(project: NonNullable<ReturnType<typeof useProjectStore.getState>['project']>): Row[] {
  const rows: Row[] = []

  // Walk rootIds — top-level folders become rows; top-level non-folders go to Ungrouped
  const ungrouped: ID[] = []

  for (const rootId of project.rootIds) {
    const node = project.nodes[rootId]
    if (!node) continue

    if (node.type === 'folder') {
      // Collect all non-folder descendants in depth-first order
      const scenes: ID[] = []
      const walk = (ids: ID[]) => {
        for (const id of ids) {
          const n = project.nodes[id]
          if (!n) continue
          if (n.type !== 'folder') {
            scenes.push(id)
          } else {
            walk(n.childIds)
          }
        }
      }
      walk(node.childIds)
      rows.push({ folderId: rootId, folderTitle: node.title, sceneIds: scenes })
    } else {
      ungrouped.push(rootId)
    }
  }

  if (ungrouped.length > 0) {
    rows.unshift({ folderId: null, folderTitle: 'Ungrouped', sceneIds: ungrouped })
  }

  return rows
}

export default function Timeline(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const selectNode = useProjectStore((s) => s.selectNode)
  const setView = useProjectStore((s) => s.setView)
  const applyMutation = useProjectStore((s) => s.applyMutation)

  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ parentId: string | null; atIndex: number } | null>(null)

  if (!project) return <div className="main" />

  const rows = buildRows(project)

  return (
    <div className="main" style={{ overflow: 'auto', padding: '24px 16px' }}>
      {rows.length === 0 && (
        <div style={{ color: 'var(--text-3)', textAlign: 'center', paddingTop: 60, fontSize: 13 }}>
          No documents yet. Add some from the Binder.
        </div>
      )}

      {rows.map((row) => {
        const rowParentId = row.folderId

        return (
          <div key={row.folderId ?? '__ungrouped'} style={{ marginBottom: 32 }}>
            {/* Row header */}
            <div style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--text-3)',
              marginBottom: 10,
              paddingLeft: 4,
            }}>
              {row.folderTitle}
            </div>

            {/* Horizontal scroll area with connecting line */}
            <div style={{ position: 'relative' }}>
              {/* Connecting line behind cards */}
              {row.sceneIds.length > 1 && (
                <div style={{
                  position: 'absolute',
                  top: 104,
                  left: 80,
                  right: 80,
                  height: 2,
                  background: 'var(--border)',
                  zIndex: 0,
                }} />
              )}

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  gap: 12,
                  overflowX: 'auto',
                  paddingBottom: 8,
                  paddingTop: 4,
                  paddingLeft: 4,
                  paddingRight: 4,
                  alignItems: 'flex-start',
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                }}
                onDrop={async (e) => {
                  e.preventDefault()
                  if (!dragId || !dropTarget || !project) return
                  const dt = dropTarget
                  setDragId(null)
                  setDropTarget(null)
                  try {
                    const result = await window.api.node.mutate(project.id, { type: 'move', id: dragId, newParentId: dt.parentId, atIndex: dt.atIndex })
                    applyMutation(result)
                  } catch (err) { console.error(err) }
                }}
              >
                {row.sceneIds.length === 0 && (
                  <div style={{ color: 'var(--text-3)', fontSize: 12, padding: '16px 8px' }}>
                    No scenes in this chapter.
                  </div>
                )}

                {row.sceneIds.map((id, i) => {
                  const node = project.nodes[id]
                  if (!node) return null
                  const statusMeta = STATUS_META[node.meta.status]
                  const words = wordCount(project.docs[id]?.content ?? '')
                  const isSelected = selectedId === id
                  const synopsis = node.meta.synopsis ?? ''
                  const cardParentId = project.nodes[id]?.parentId ?? null

                  return (
                    <React.Fragment key={id}>
                      {/* Drop indicator before this card */}
                      {dropTarget && dropTarget.parentId === rowParentId && dropTarget.atIndex === i && (
                        <div style={{ width: 3, alignSelf: 'stretch', background: 'var(--accent)', borderRadius: 2, flexShrink: 0 }} />
                      )}

                      <div
                        draggable
                        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragId(id) }}
                        onDragEnd={() => { setDragId(null); setDropTarget(null) }}
                        onDragOver={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          e.dataTransfer.dropEffect = 'move'
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                          const isAfter = e.clientX > rect.left + rect.width / 2
                          setDropTarget({ parentId: cardParentId, atIndex: isAfter ? i + 1 : i })
                        }}
                        onDrop={async (e) => {
                          e.preventDefault()
                          if (!dragId || dragId === id || !dropTarget || !project) return
                          const dt = dropTarget
                          setDragId(null); setDropTarget(null)
                          try {
                            const result = await window.api.node.mutate(project.id, { type: 'move', id: dragId, newParentId: dt.parentId, atIndex: dt.atIndex })
                            applyMutation(result)
                          } catch (err) { console.error(err) }
                        }}
                        onClick={() => selectNode(id)}
                        onDoubleClick={() => { selectNode(id); setView('editor') }}
                        style={{
                          position: 'relative',
                          zIndex: 1,
                          flexShrink: 0,
                          width: 160,
                          height: 200,
                          background: 'var(--bg-2)',
                          border: isSelected
                            ? '2px solid var(--accent)'
                            : '1px solid var(--border)',
                          borderRadius: 6,
                          overflow: 'hidden',
                          cursor: 'grab',
                          display: 'flex',
                          flexDirection: 'column',
                          transition: 'box-shadow 0.15s',
                          boxShadow: isSelected ? '0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent)' : undefined,
                          opacity: dragId === id ? 0.4 : 1,
                        }}
                      >
                        {/* Status color bar */}
                        <div style={{
                          height: 4,
                          background: statusMeta?.color ?? 'var(--border)',
                          flexShrink: 0,
                        }} />

                        {/* Card body */}
                        <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                          {/* Title */}
                          <div style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: 'var(--text)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            marginBottom: 4,
                          }}>
                            {node.title}
                          </div>

                          {/* Word count */}
                          <div style={{
                            fontSize: 10,
                            color: 'var(--text-3)',
                            marginBottom: 6,
                          }}>
                            {words > 0 ? `${words.toLocaleString()} words` : 'No content'}
                          </div>

                          {/* Synopsis */}
                          <div style={{
                            fontSize: 11,
                            fontStyle: 'italic',
                            color: 'var(--text-2)',
                            flex: 1,
                            overflow: 'hidden',
                            display: '-webkit-box',
                            WebkitLineClamp: 5,
                            WebkitBoxOrient: 'vertical',
                            lineHeight: 1.45,
                          }}>
                            {synopsis || <span style={{ color: 'var(--text-3)' }}>No synopsis</span>}
                          </div>

                          {/* Status pill */}
                          <div style={{
                            marginTop: 8,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            background: 'var(--bg-3)',
                            borderRadius: 10,
                            padding: '2px 7px',
                            alignSelf: 'flex-start',
                          }}>
                            <span style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: statusMeta?.color ?? 'var(--border)',
                              flexShrink: 0,
                              display: 'inline-block',
                            }} />
                            <span style={{ fontSize: 10, color: 'var(--text-2)', fontWeight: 500 }}>
                              {statusMeta?.label ?? node.meta.status}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Drop indicator after last card */}
                      {i === row.sceneIds.length - 1 && dropTarget && dropTarget.parentId === rowParentId && dropTarget.atIndex === row.sceneIds.length && (
                        <div style={{ width: 3, alignSelf: 'stretch', background: 'var(--accent)', borderRadius: 2, flexShrink: 0 }} />
                      )}
                    </React.Fragment>
                  )
                })}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
