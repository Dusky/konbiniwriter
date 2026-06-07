import React, { useState } from 'react'
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
  // locationKey: opaque handle key from BrowserProjectService; locationDisplay: shown to user
  const [locationKey, setLocationKey] = useState<string | null>(null)
  const [locationDisplay, setLocationDisplay] = useState<string>('')
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const setScreen = useShellStore((s) => s.setScreen)
  const touchRecent = useShellStore((s) => s.touchRecent)
  const loadProject = useProjectStore((s) => s.loadProject)

  const handleBrowse = async () => {
    const result = await window.api.project.showSaveDialog(title)
    if (!result) return
    // result is "handleKey::dirName"
    const [key, dirName] = result.split('::')
    setLocationKey(result)
    setLocationDisplay(dirName ?? result)
    setErr(null)
  }

  const handleCreate = async () => {
    if (!title.trim() || creating) return
    if (!locationKey) {
      // Auto-show the picker if they haven't browsed yet
      await handleBrowse()
      return
    }
    setCreating(true)
    setErr(null)
    try {
      const project = await window.api.project.create({
        title: title.trim(),
        template,
        location: locationKey,
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
    } catch (e) {
      setErr(String(e))
      setCreating(false)
    }
  }

  const canCreate = !!title.trim() && !creating

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
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

          <div className="np-field">
            <label>Save inside folder</label>
            <div className="loc-row">
              <div className="loc-path" style={{ fontStyle: locationKey ? 'normal' : 'italic', opacity: locationKey ? 1 : 0.6 }}>
                {locationKey
                  ? <><b>{locationDisplay}</b> / {title || 'Untitled'}.konbini</>
                  : 'Click Browse… to choose a folder'}
              </div>
              <button className="btn" onClick={handleBrowse}>Browse…</button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '6px 0 0' }}>
              The project will be created as <b>{title || 'Untitled'}.konbini</b> inside the folder you pick.
              Requires a modern browser (Chrome/Edge) for filesystem access.
            </p>
          </div>

          {err && (
            <div style={{ background: 'color-mix(in oklch, var(--st-idea) 15%, transparent)', border: '0.5px solid var(--st-idea)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--st-idea)', marginTop: 8 }}>
              {err}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <span className="tb-spacer" />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={handleCreate} disabled={!canCreate}>
            {creating ? 'Creating…' : locationKey ? 'Create Project' : 'Choose Folder & Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
