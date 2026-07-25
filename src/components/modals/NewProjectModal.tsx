import React, { useState, useRef, useEffect } from 'react'
import { isFileSystemAccessSupported } from '../../lib/BrowserProjectService'
import { useShellStore } from '../../store/shellStore'
import { useProjectStore } from '../../store/projectStore'
import type { TemplateId, ImportDoc } from '@shared/types'
import { isDocx, docxToText } from '../../lib/docxImport'
import { isScrivenerBundle, parseScrivener } from '@shared/scrivener'
import Icon, { type IconName } from '../common/Icon'

const IMPORTABLE = /\.(md|markdown|mdown|txt|text|docx)$/i

export const TEMPLATES: { id: TemplateId; icon: IconName; label: string; desc: string }[] = [
  { id: 'novel',       icon: 'book',         label: 'Novel',       desc: 'Three-act structure with chapter/scene hierarchy.' },
  { id: 'blank',       icon: 'document',     label: 'Blank',       desc: 'A single empty document to start freely.' },
  { id: 'screenplay',  icon: 'clapperboard', label: 'Screenplay',  desc: 'Acts and scenes in standard script format.' },
  { id: 'nonfiction',  icon: 'notebook',     label: 'Non-fiction', desc: 'Chapters and sections for long-form non-fiction.' },
]

interface Props { onClose: () => void; initialTemplate?: TemplateId }

export default function NewProjectModal({ onClose, initialTemplate }: Props): React.ReactElement {
  const [title, setTitle] = useState('Untitled Project')
  const [template, setTemplate] = useState<TemplateId>(initialTemplate ?? 'novel')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setScreen = useShellStore((s) => s.setScreen)
  const touchRecent = useShellStore((s) => s.touchRecent)
  const loadProject = useProjectStore((s) => s.loadProject)

  // Folder import: webkitdirectory is set imperatively (not a valid JSX attr).
  const importInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = importInputRef.current
    if (el) { el.setAttribute('webkitdirectory', ''); el.setAttribute('directory', '') }
  }, [])

  const openProject = (project: Parameters<typeof loadProject>[0]) => {
    touchRecent({
      id: project.id, title: project.title, location: project.settings.location,
      opened: Date.now(), words: 0,
      template: (project.settings.template as TemplateId) ?? 'blank', accent: project.settings.accent,
    })
    loadProject(project)
    setScreen('studio')
    onClose()
  }

  const handleImportFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const all = Array.from(e.target.files ?? [])
    e.target.value = ''
    const rel = (f: File) => (f.webkitRelativePath || f.name).replace(/\\/g, '/')

    // A Scrivener project is just a folder, so the same picker finds it — detect
    // the .scrivx manifest and take the Scrivener path instead of treating the
    // bundle's internals as loose files.
    if (isScrivenerBundle(all.map(rel))) {
      setError(null); setCreating(true)
      try {
        const scrivFiles = all.filter((f) => /\.(scrivx|rtf|txt)$/i.test(f.name))
        const map = new Map<string, string>()
        for (const f of scrivFiles) {
          const p = rel(f)
          map.set(p.includes('/') ? p.split('/').slice(1).join('/') : p, await f.text())
        }
        const parsed = parseScrivener(map)
        if ('error' in parsed) { setError(parsed.error); setCreating(false); return }
        const importTitle = (title.trim() && title.trim() !== 'Untitled Project') ? title.trim() : parsed.title
        const project = await window.api.project.import({ title: importTitle, location: 'browser-pick', docs: parsed.docs })
        openProject(project)
      } catch (err) {
        const isUserCancel = (err instanceof DOMException && err.name === 'AbortError') || String(err).includes('No folder selected')
        if (!isUserCancel) setError(String(err).replace(/^Error:\s*/, ''))
        setCreating(false)
      }
      return
    }

    const files = all.filter((f) => IMPORTABLE.test(f.name))
    if (files.length === 0) { setError('No Markdown, text, Word (.docx), or Scrivener files found in that folder.'); return }
    setError(null); setCreating(true)
    try {
      const topFolder = rel(files[0]).split('/')[0]
      const importTitle = (title.trim() && title.trim() !== 'Untitled Project') ? title.trim() : (topFolder || 'Imported Project')
      // Strip the wrapping top-level folder so it becomes the project itself.
      const docs: ImportDoc[] = await Promise.all(files.map(async (f) => {
        const p = rel(f)
        const raw = p.includes('/') ? p.split('/').slice(1).join('/') : p
        // .docx → prose via mammoth; rename the node to a .md path so the
        // importer titles it cleanly and the bundle stores Markdown.
        const isWord = isDocx(f.name)
        // A single unreadable .docx shouldn't abort the whole folder import —
        // fall back to an empty doc so the rest still comes in.
        const content = isWord
          ? await docxToText(f).catch(() => '')
          : await f.text()
        const path = isWord ? (raw || f.name).replace(/\.docx$/i, '.md') : (raw || f.name)
        return { path, content }
      }))
      const project = await window.api.project.import({ title: importTitle, location: 'browser-pick', docs })
      openProject(project)
    } catch (err) {
      const isUserCancel = (err instanceof DOMException && err.name === 'AbortError') || String(err).includes('No folder selected')
      if (!isUserCancel) setError(String(err).replace(/^Error:\s*/, ''))
      setCreating(false)
    }
  }

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
      openProject(project)
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
                  <span className="tc-glyph"><Icon name={t.icon} size={22} /></span>
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
          <div style={{ margin: '0 20px 12px', padding: '10px 12px', background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', borderRadius: 'var(--r-md)', fontSize: 12, color: 'var(--warn-text)', lineHeight: 1.5 }}>
            ⚠ This browser has no disk access — your project will be saved in browser storage (Firefox/Safari). For real files on disk, use Chrome/Edge or the desktop app.
          </div>
        )}
        {error && (
          <div style={{ margin: '0 20px 12px', padding: '10px 12px', background: 'oklch(0.22 0.05 20)', border: '1px solid var(--st-idea)', borderRadius: 'var(--r-md)', fontSize: 12, color: 'var(--st-idea)', lineHeight: 1.5 }}>
            {error}
          </div>
        )}

        <input ref={importInputRef} type="file" multiple onChange={handleImportFiles} style={{ display: 'none' }} />
        <div className="modal-foot">
          <button className="btn ghost" onClick={() => importInputRef.current?.click()} disabled={creating}
            title="Import a Scrivener .scriv project, or a folder of Markdown / text / Word (.docx) files">
            Import folder…
          </button>
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
