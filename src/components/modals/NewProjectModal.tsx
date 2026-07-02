import React, { useState } from 'react'
import { isFileSystemAccessSupported } from '../../lib/BrowserProjectService'
import { useShellStore } from '../../store/shellStore'
import { useProjectStore } from '../../store/projectStore'
import type { TemplateId } from '@shared/types'

const TEMPLATES: { id: TemplateId; glyph: string; label: string; desc: string }[] = [
  { id: 'novel',       glyph: '冊', label: 'Novel',       desc: 'Three-act structure with chapter/scene hierarchy.' },
  { id: 'blank',       glyph: '□',  label: 'Blank',       desc: 'A single empty document to start freely.' },
  { id: 'screenplay',  glyph: '幕', label: 'Screenplay',  desc: 'Acts and scenes in standard script format.' },
  { id: 'nonfiction',  glyph: '頁', label: 'Non-fiction', desc: 'Chapters and sections for long-form non-fiction.' },
]

interface Props { onClose: () => void }

export default function NewProjectModal({ onClose }: Props): React.ReactElement {
  const [title, setTitle] = useState('Untitled Project')
  const [template, setTemplate] = useState<TemplateId>('novel')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setScreen = useShellStore((s) => s.setScreen)
  const touchRecent = useShellStore((s) => s.touchRecent)
  const loadProject = useProjectStore((s) => s.loadProject)

  const handleCreate = async () => {
    if (!title.trim() || creating) return
    setError(null)
    setCreating(true)
    try {
      // Single-call flow: 'browser-pick' opens the folder picker synchronously
      // within the user gesture (FSA), the native dialog (Electron), or is
      // ignored entirely (OPFS / Firefox). One path for every backend.
      const project = await window.api.project.create({
        title: title.trim(),
        template,
        location: 'browser-pick',
      })
      touchRecent({
        id: project.id,
        title: project.title,
        location: project.settings.location,
        opened: Date.now(),
        words: 0,
        template,
        accent: project.settings.accent,
      })
      loadProject(project)
      setScreen('studio')
      onClose()
    } catch (err) {
      const isUserCancel = (err instanceof DOMException && (err as DOMException).name === 'AbortError')
        || String(err).includes('No folder selected')
      if (!isUserCancel) setError(String(err).replace(/^Error:\s*/, ''))
      setCreating(false)
    }
  }

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-label="New Project">
        <div className="modal-hd">
          <h3>New Project</h3>
          <span className="sub">Choose a template and name your project</span>
        </div>
        <div className="modal-body">
          <div className="np-field">
            <label>Project Name</label>
            <input
              className="inp"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
          </div>

          <div className="np-field">
            <label>Template</label>
            <div className="tmpl-grid">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  className={`tmpl-card${template === t.id ? ' on' : ''}`}
                  onClick={() => setTemplate(t.id)}
                >
                  <span className="tc-glyph">{t.glyph}</span>
                  <span className="tc-label">{t.label}</span>
                  <span className="tc-desc">{t.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="np-field" style={{ marginBottom: 0 }}>
            <label>Location</label>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>
              A folder picker will open first. Your project will be saved as a <code style={{ fontFamily: 'var(--mono)', background: 'var(--bg)', padding: '1px 4px', borderRadius: 3 }}>.konbini</code> bundle inside it.
            </div>
          </div>
        </div>

        {!isFileSystemAccessSupported() && (
          <div style={{ margin: '0 20px 12px', padding: '10px 12px', background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', borderRadius: 6, fontSize: 12, color: 'var(--warn-text)', lineHeight: 1.5 }}>
            ⚠ This browser has no disk access — your project will be saved in browser storage (Firefox/Safari). For real files on disk, use Chrome/Edge or the desktop app.
          </div>
        )}
        {error && (
          <div style={{ margin: '0 20px 12px', padding: '10px 12px', background: 'oklch(0.22 0.05 20)', border: '1px solid var(--st-idea)', borderRadius: 6, fontSize: 12, color: 'var(--st-idea)', lineHeight: 1.5 }}>
            {error}
          </div>
        )}

        <div className="modal-foot">
          <span className="tb-spacer" />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={handleCreate} disabled={creating || !title.trim()}>
            {creating ? 'Creating…' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  )
}
