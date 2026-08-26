import React, { useState, useEffect } from 'react'
import { useProjectStore, descendants } from '../../store/projectStore'
import { manuscriptText, wordCount } from '@shared/utils'
import Icon from '../common/Icon'
import type { CompileFormat } from '@shared/types'

interface Props { onClose: () => void }

export default function CompileModal({ onClose }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const updateProjectSettings = useProjectStore((s) => s.updateProjectSettings)

  const [author, setAuthor] = useState(project?.settings.author ?? '')
  const [rootId, setRootId] = useState<string>('')
  const [included, setIncluded] = useState<Set<string>>(new Set())
  const [format, setFormat] = useState<CompileFormat>('markdown')
  const [preview, setPreview] = useState('')
  const [compiling, setCompiling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Every folder the author could compile from, indented by depth — the same
  // walk AdventureSetup uses to offer a target folder.
  const folders = React.useMemo(() => {
    if (!project) return [] as { id: string; title: string; depth: number }[]
    const out: { id: string; title: string; depth: number }[] = []
    const walk = (ids: string[], depth: number) => {
      for (const id of ids) {
        const n = project.nodes[id]
        if (!n || n.type !== 'folder' || id === project.trashId) continue
        out.push({ id, title: n.title, depth })
        walk(n.childIds, depth + 1)
      }
    }
    walk(project.rootIds.filter((id) => id !== project.trashId), 0)
    return out
  }, [project])

  // Default root = selected folder or project root
  useEffect(() => {
    if (!project) return
    const defaultRoot = selectedId && project.nodes[selectedId]?.type === 'folder'
      ? selectedId
      : project.rootIds[0] ?? ''
    setRootId(defaultRoot)
  }, [project, selectedId])

  // Build included set from all compile-eligible docs under rootId
  useEffect(() => {
    if (!project || !rootId) return
    const node = project.nodes[rootId]
    if (!node) return
    const ids = [rootId, ...descendants(project, rootId)]
    const eligible = ids.filter((id) => {
      const n = project.nodes[id]
      return n && n.type !== 'folder' && n.meta.includeInCompile
    })
    setIncluded(new Set(eligible))
  }, [rootId, project])

  // Build preview from included docs
  useEffect(() => {
    if (!project) return
    if (!rootId) { setPreview(''); return }
    const gather = (id: string): string[] => {
      const node = project.nodes[id]
      if (!node) return []
      if (node.type !== 'folder' && included.has(id)) {
        // Through the same helper the backends use, or the preview shows the
        // author something the export will not produce — which is exactly what
        // it did: `[[Reiko]]` here, "Reiko" in the file.
        return [manuscriptText(project.docs[id]?.content?.trim() ?? '')]
      }
      return node.childIds.flatMap(gather).filter(Boolean)
    }
    setPreview(gather(rootId).join('\n\n---\n\n'))
  }, [included, rootId, project])

  if (!project) return <></>

  const allDocIds = rootId
    ? [rootId, ...descendants(project, rootId)].filter((id) => {
        const n = project.nodes[id]
        return n && n.type !== 'folder'
      })
    : []

  const toggleInclude = (id: string) =>
    setIncluded((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })

  // Gather included docs in binder order as {title, content} chapters.
  const gatherChapters = (): Array<{ title: string; content: string }> => {
    const out: Array<{ title: string; content: string }> = []
    const walk = (id: string) => {
      const node = project.nodes[id]
      if (!node) return
      if (node.type !== 'folder' && included.has(id)) {
        const content = project.docs[id]?.content?.trim() ?? ''
        if (content) out.push({ title: node.title, content })
      }
      node.childIds.forEach(walk)
    }
    if (rootId) walk(rootId)
    return out
  }

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s: string) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')

  const handlePrint = () => {
    const title = project.title
    const chapters = gatherChapters()
    const chapterHtml = chapters.map((ch) => {
      const lines = ch.content.split('\n')
      let first = true
      const body = lines.map((raw) => {
        const t = raw.trim()
        if (!first && /^#\s+/.test(t) && t.replace(/^#\s+/, '') === ch.title) return ''
        if (t === '') return ''
        first = false
        if (/^(-{3,}|\*{3,}|#)\s*$/.test(t)) return '<p class="scene">#</p>'
        return `<p>${inline(t.replace(/^#{1,6}\s+/, ''))}</p>`
      }).filter(Boolean).join('\n')
      return `<section class="chapter"><h2>${esc(ch.title)}</h2>${body}</section>`
    }).join('\n')

    const titlePage = `<section class="titlepage"><h1>${esc(title)}</h1>${author ? `<p class="byline">${esc(author)}</p>` : ''}</section>`
    const newWin = window.open('', '_blank')
    if (!newWin) { setError('Pop-ups are blocked. Allow pop-ups for this site, then try again.'); return }
    newWin.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: 6in 9in; margin: 0.75in 0.7in; }
  html, body { margin: 0; }
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.5; color: #111; }
  .titlepage { height: 90vh; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; page-break-after: always; }
  .titlepage h1 { font-size: 26pt; font-weight: 600; margin: 0 0 0.4in; letter-spacing: 0.01em; }
  .byline { font-size: 13pt; font-style: italic; color: #333; }
  .chapter { page-break-before: always; }
  .chapter h2 { font-size: 16pt; font-weight: 600; text-align: center; margin: 1.6in 0 0.5in; }
  .chapter p { margin: 0; text-indent: 1.6em; text-align: justify; orphans: 2; widows: 2; }
  .chapter h2 + p, .scene + p { text-indent: 0; }
  .scene { text-indent: 0 !important; text-align: center; margin: 0.9em 0; letter-spacing: 0.3em; }
</style></head><body>${titlePage}${chapterHtml}</body></html>`)
    newWin.document.close()
    setTimeout(() => { newWin.print(); newWin.close() }, 400)
    onClose()
  }

  const handleCompile = async () => {
    if (!rootId || compiling) return
    // Persist the current author so the backend (which reads project.settings)
    // uses it even if the field wasn't blurred.
    updateProjectSettings({ author: author.trim() || undefined })
    if (format === 'print') { handlePrint(); return }
    setCompiling(true)
    try {
      const result = await window.api.compile.run(project.id, rootId, [...included], format)
      const mimeType =
        format === 'docx' || format === 'shunn' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : format === 'epub' ? 'application/epub+zip'
        : 'text/markdown'
      const blob = new Blob([new Uint8Array(result.blob)], { type: mimeType })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = result.filename
      a.click()
      URL.revokeObjectURL(url)
      onClose()
    } catch (err) {
      setError(`Compile failed: ${String(err)}`)
    } finally {
      setCompiling(false)
    }
  }

  const totalWords = [...included].reduce((acc, id) => acc + wordCount(project.docs[id]?.content ?? ''), 0)

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Compile">
        <div className="modal-hd">
          <h3>Compile</h3>
          <span className="sub">{included.size} documents · {totalWords.toLocaleString()} words</span>
        </div>
        {error && (
          <div role="alert" className="err-banner" style={{ margin: '0 0 2px' }}>
            <span className="err-banner-ic"><Icon name="warning" size={14} /></span>
            <span className="err-banner-txt">{error}</span>
            <button className="err-banner-x" onClick={() => setError(null)}><Icon name="x" size={14} /></button>
          </div>
        )}
        <div className="modal-body cmp-body">
          {/* Left: what is being compiled, then which of it */}
          <div style={{ overflowY: 'auto' }}>
            {/* The scope used to be derived from the binder selection and shown
                nowhere: selecting a scene compiled the whole book, selecting a
                folder compiled just that folder, and the modal said only
                "N documents". The number changed under you with no visible
                cause. */}
            <div className="cmp-lbl">Compile</div>
            <select
              className="sel"
              value={rootId}
              onChange={(e) => setRootId(e.target.value)}
              style={{ marginBottom: 'var(--s4)' }}
              aria-label="What to compile"
            >
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{'\u00a0\u00a0'.repeat(f.depth)}{f.title}</option>
              ))}
            </select>
            <div className="cmp-lbl">Documents</div>
            <div className="tree-pick">
              {allDocIds.map((id) => {
                const node = project.nodes[id]
                if (!node) return null
                return (
                  <label key={id} className="tp-row">
                    <input
                      type="checkbox"
                      checked={included.has(id)}
                      onChange={() => toggleInclude(id)}
                    />
                    <span>{node.title}</span>
                  </label>
                )
              })}
              {allDocIds.length === 0 && (
                <div style={{ color: 'var(--text-3)', fontSize: 'var(--t-sm)' }}>No documents.</div>
              )}
            </div>
          </div>

          {/* Right: format + preview */}
          <div className="cmp-right">
            <div>
              <div className="cmp-lbl">Author</div>
              <input
                className="inp"
                style={{ width: '100%' }}
                placeholder="Your name (used on the title page & metadata)"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                onBlur={() => updateProjectSettings({ author: author.trim() || undefined })}
              />
            </div>
            <div>
              <div className="cmp-lbl">Format</div>
              <div className="seg" style={{ display: 'inline-flex', flexWrap: 'wrap' }}>
                <button className={format === 'docx' ? 'on' : ''} onClick={() => setFormat('docx')} title="Readable manuscript layout">Word (.docx)</button>
                <button className={format === 'shunn' ? 'on' : ''} onClick={() => setFormat('shunn')} title="Standard manuscript format for agent/editor submission">Manuscript (Shunn)</button>
                <button className={format === 'epub' ? 'on' : ''} onClick={() => setFormat('epub')}>EPUB</button>
                <button className={format === 'print' ? 'on' : ''} onClick={() => setFormat('print')}>Print / PDF</button>
                <button className={format === 'markdown' ? 'on' : ''} onClick={() => setFormat('markdown')}>Markdown</button>
              </div>
              {format === 'shunn' && (
                <div style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)', marginTop: 6, lineHeight: 1.5 }}>
                  Courier 12pt, double-spaced, word-count title page, running header — the format agents expect.
                </div>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div className="cmp-lbl">Preview</div>
              <div className="compile-preview">{preview || '(no content)'}</div>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <span className="tb-spacer" />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={handleCompile} disabled={compiling || included.size === 0}>
            {compiling ? 'Compiling…'
            : format === 'print' ? 'Print / PDF'
            : format === 'epub' ? 'Export .epub'
            : format === 'shunn' ? 'Export manuscript'
            : format === 'docx' ? 'Export .docx'
            : 'Export .md'}
          </button>
        </div>
      </div>
    </div>
  )
}
