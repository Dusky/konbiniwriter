import React, { useState } from 'react'
import { useShellStore } from '../../store/shellStore'
import { useProjectStore } from '../../store/projectStore'
import { relTime, fmtWords } from '@shared/utils'
import NewProjectModal from '../modals/NewProjectModal'
import type { RecentEntry } from '@shared/types'

export default function Launch(): React.ReactElement {
  const recents = useShellStore((s) => s.recents)
  const setScreen = useShellStore((s) => s.setScreen)
  const setModal = useShellStore((s) => s.setModal)
  const modal = useShellStore((s) => s.modal)
  const removeRecent = useShellStore((s) => s.removeRecent)
  const loadProject = useProjectStore((s) => s.loadProject)

  const openRecent = async (r: RecentEntry) => {
    try {
      const project = await window.api.project.open(r.location)
      loadProject(project)
      setScreen('studio')
    } catch (err) {
      alert(`Could not open project: ${err}`)
    }
  }

  const handleOpen = async () => {
    const path = await window.api.project.showOpenDialog()
    if (!path) return
    try {
      const project = await window.api.project.open(path)
      loadProject(project)
      setScreen('studio')
    } catch (err) {
      alert(`Could not open project: ${err}`)
    }
  }

  const handleRemoveRecent = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    await window.api.project.removeRecent(id)
    removeRecent(id)
  }

  return (
    <div className="launch-stage">
      <div className="launch-win">
        {/* Left panel */}
        <div className="launch-left">
          <div className="ll-top">
            <div className="ll-mark">✦</div>
            <div className="ll-name">Konbini</div>
            <div className="ll-tag">Writing Studio</div>
            <div className="ll-actions">
              <button className="ll-btn primary" onClick={() => setModal('new-project')}>
                <span className="llb-ic">✦</span>
                <span><b>New Project</b><small>Start writing something new</small></span>
              </button>
              <button className="ll-btn" onClick={handleOpen}>
                <span className="llb-ic">⊕</span>
                <span><b>Open Project</b><small>Browse for a .konbini bundle</small></span>
              </button>
            </div>
          </div>
          <div className="ll-foot">
            <span>Konbini v0.1.0</span>
          </div>
        </div>

        {/* Right panel — recents */}
        <div className="launch-right">
          <div className="lr-head">Recent Projects</div>
          <div className="lr-list">
            {recents.length === 0 ? (
              <div className="lr-empty">
                No recent projects yet.<br />Create or open one to get started.
              </div>
            ) : (
              recents.map((r) => (
                <div key={r.id} className="recent-row" onClick={() => openRecent(r)}>
                  <div className="recent-spine" style={{ background: r.accent ?? 'var(--accent)' }} />
                  <div className="recent-main">
                    <div className="recent-title">{r.title}</div>
                    <div className="recent-path">{r.location}</div>
                  </div>
                  <div className="recent-meta">
                    <div className="rm-words">{fmtWords(r.words ?? 0)} words</div>
                    <div className="rm-when">{relTime(r.opened)}</div>
                  </div>
                  <button
                    className="recent-x"
                    title="Remove from recents"
                    onClick={(e) => handleRemoveRecent(e, r.id)}
                  >✕</button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {modal === 'new-project' && (
        <NewProjectModal onClose={() => setModal(null)} />
      )}
    </div>
  )
}
