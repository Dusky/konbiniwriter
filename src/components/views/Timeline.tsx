import React, { useState } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
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
    <div className="main tl">
      {rows.length === 0 && (
        <div className="tl-empty">
          No documents yet. Add some from the Binder.
        </div>
      )}

      {rows.map((row) => {
        const rowParentId = row.folderId

        return (
          <div key={row.folderId ?? '__ungrouped'} className="tl-row">
            {/* Row header */}
            <div className="tl-row-hd">
              {row.folderTitle}
            </div>

            {/* Horizontal scroll area with connecting line */}
            <div className="tl-track">
              {/* Connecting line behind cards */}
              {row.sceneIds.length > 1 && <div className="tl-line" />}

              <div
                className="tl-cards"
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
                  } catch (e) { useShellStore.getState().setToast('Move could not be saved: ' + (e as Error).message); return }
                }}
              >
                {row.sceneIds.length === 0 && (
                  <div className="tl-empty-row">
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
                        <div className="tl-drop" />
                      )}

                      <div
                        draggable
                        className={`tl-card${isSelected ? ' sel' : ''}${dragId === id ? ' dragging' : ''}`}
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
                          } catch (e) { useShellStore.getState().setToast('Move could not be saved: ' + (e as Error).message); return }
                        }}
                        onClick={() => selectNode(id)}
                        onDoubleClick={() => { selectNode(id); setView('editor') }}
                      >
                        {/* Status color bar */}
                        <div className="tl-card-bar" style={{ background: statusMeta?.color ?? 'var(--border)' }} />

                        {/* Card body */}
                        <div className="tl-card-body">
                          <div className="tl-card-title">{node.title}</div>

                          <div className="tl-card-wc">
                            {words > 0 ? `${words.toLocaleString()} words` : 'No content'}
                          </div>

                          <div className="tl-card-syn">
                            {synopsis || <span style={{ color: 'var(--text-3)' }}>No synopsis</span>}
                          </div>

                          {/* Status pill */}
                          <div className="tl-card-pill">
                            <span className="dot" style={{ background: statusMeta?.color ?? 'var(--border)' }} />
                            <span className="lbl">{statusMeta?.label ?? node.meta.status}</span>
                          </div>
                        </div>
                      </div>

                      {/* Drop indicator after last card */}
                      {i === row.sceneIds.length - 1 && dropTarget && dropTarget.parentId === rowParentId && dropTarget.atIndex === row.sceneIds.length && (
                        <div className="tl-drop" />
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
