import React, { useState } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
import { STATUS_META, wordCount } from '@shared/utils'
import type { ID, Project } from '@shared/types'

export interface Row {
  folderId: ID | null
  folderTitle: string
  /** The path above this lane — "Manuscript › Part One" — for context. */
  folderPath: string
  sceneIds: ID[]
}

/**
 * The book as lanes of cards.
 *
 * One lane per folder that *directly holds documents* — which for a novel means
 * one lane per chapter. It used to be one lane per top-level folder with every
 * descendant flattened into it, so the whole manuscript arrived as a single
 * undivided row and you could not see where one chapter ended and the next
 * began. Trash got a lane too.
 *
 * Exported so the grouping can be tested without a browser.
 */
export function buildRows(project: Project): Row[] {
  const rows: Row[] = []
  const ungrouped: ID[] = []

  const walk = (ids: ID[], path: string[]) => {
    for (const id of ids) {
      const node = project.nodes[id]
      if (!node || id === project.trashId) continue
      if (node.type !== 'folder') continue

      // Documents sitting directly in this folder are its lane; child folders
      // get lanes of their own, so a Part with chapters under it contributes
      // nothing itself and the chapters each get a row.
      const direct = node.childIds.filter((cid) => project.nodes[cid] && project.nodes[cid]!.type !== 'folder')
      if (direct.length > 0) {
        rows.push({ folderId: id, folderTitle: node.title, folderPath: path.join(' › '), sceneIds: direct })
      }
      walk(node.childIds, [...path, node.title])
    }
  }

  const roots = project.rootIds.filter((id) => id !== project.trashId)
  for (const rootId of roots) {
    const node = project.nodes[rootId]
    if (node && node.type !== 'folder') ungrouped.push(rootId)
  }
  walk(roots, [])

  if (ungrouped.length > 0) {
    rows.unshift({ folderId: null, folderTitle: 'Ungrouped', folderPath: '', sceneIds: ungrouped })
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
              {row.folderPath && <span className="tl-row-path">{row.folderPath} › </span>}
              {row.folderTitle}
              <span className="tl-row-count">{row.sceneIds.length}</span>
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
