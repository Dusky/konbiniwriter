import React, { useState } from 'react'
import { useShellStore } from '../../store/shellStore'
import { useProjectStore } from '../../store/projectStore'
import { relTime, fmtWords } from '@shared/utils'
import Icon from '../common/Icon'
import NewProjectModal from '../modals/NewProjectModal'
import CommandPalette from '../modals/CommandPalette'
import ShortcutsModal from '../modals/ShortcutsModal'
import AboutModal from '../modals/AboutModal'
import WindowControls from '../shell/WindowControls'
import { isFileSystemAccessSupported } from '../../lib/BrowserProjectService'
import { isOPFSSupported } from '../../lib/OPFSProjectService'
import type { RecentEntry } from '@shared/types'

export default function Launch(): React.ReactElement {
  const recents = useShellStore((s) => s.recents)
  const setScreen = useShellStore((s) => s.setScreen)
  const modal = useShellStore((s) => s.modal)
  const setModal = useShellStore((s) => s.setModal)
  const removeRecent = useShellStore((s) => s.removeRecent)
  const loadProject = useProjectStore((s) => s.loadProject)
  const [openErr, setOpenErr] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)

  const finish = (project: Awaited<ReturnType<typeof window.api.project.open>>) => {
    loadProject(project)
    setScreen('studio')
  }

  // Open via folder picker (FSA / Electron native dialog).
  const doOpen = async () => {
    setOpenErr(null)
    setOpening(true)
    try {
      const handleKey = await window.api.project.showOpenDialog()
      if (!handleKey) { setOpening(false); return }
      finish(await window.api.project.open(handleKey))
    } catch (e) {
      setOpenErr(`Could not open project: ${e}`)
      setOpening(false)
    }
  }

  // Open a recent. On Chrome/Edge this resolves the persisted directory handle
  // (re-prompting for permission if needed); on OPFS/Electron it opens by
  // location. If the handle is gone or permission is denied, fall back to the
  // folder picker.
  const openRecent = async (r: RecentEntry) => {
    setOpenErr(null)
    setOpening(true)
    try {
      finish(await window.api.project.openRecent(r.id, r.location))
    } catch {
      setOpening(false)
      await doOpen()
    }
  }

  const handleRemoveRecent = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    await window.api.project.removeRecent(id)
    removeRecent(id)
  }

  // Only browser-FSA needs the "Chrome/Edge required" caveat. OPFS browsers
  // and Electron both have working storage.
  const showFsaCaveat = !isFileSystemAccessSupported() && !isOPFSSupported()

  return (
    <div className="launch-stage">
      {/* Frameless-window drag strip + controls (Electron, non-mac) */}
      <div className="win-bar"><span style={{ flex: 1 }} /><WindowControls /></div>
      <div className="launch-win">
        {/* Left panel */}
        <div className="launch-left">
          <div className="ll-top">
            <div className="ll-mark">✦</div>
            <div className="ll-name">Konbini</div>
            <div className="ll-tag">Writing Studio</div>
            {showFsaCaveat && (
              <div style={{ marginBottom: 12, padding: '10px 12px', background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', borderRadius: 6, fontSize: 12, color: 'var(--warn-text)', lineHeight: 1.5 }}>
                ⚠ This browser lacks file storage support. Use Chrome, Edge, Firefox, or the desktop app.
              </div>
            )}
            <div className="ll-actions">
              <button className="ll-btn primary" onClick={() => setModal('new-project')}>
                <span className="llb-ic"><Icon name="plus" /></span>
                <span><b>New Project</b><small>Start writing something new</small></span>
              </button>
              <button className="ll-btn" onClick={doOpen} disabled={opening}>
                <span className="llb-ic">{opening ? '…' : <Icon name="folder-open" />}</span>
                <span><b>{opening ? 'Opening…' : 'Open Project'}</b><small>{opening ? 'Reading manuscript files' : 'Browse for a .konbini folder'}</small></span>
              </button>
            </div>
          </div>
          {openErr && (
            <p style={{ fontSize: 12, color: 'var(--st-idea)', margin: '8px 0 0', lineHeight: 1.5 }}>{openErr}</p>
          )}
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
                <div
                  key={r.id}
                  className="recent-row"
                  onClick={() => openRecent(r)}
                  title={r.location}
                >
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
                  ><Icon name="x" size={13} /></button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {modal === 'new-project' && (
        <NewProjectModal onClose={() => setModal(null)} />
      )}
      {modal === 'command-palette' && <CommandPalette onClose={() => setModal(null)} />}
      {modal === 'shortcuts' && <ShortcutsModal onClose={() => setModal(null)} />}
      {modal === 'about' && <AboutModal onClose={() => setModal(null)} />}
    </div>
  )
}
