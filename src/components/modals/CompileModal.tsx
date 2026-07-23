import React, { useState, useEffect } from 'react'
import { useProjectStore, descendants } from '../../store/projectStore'
import { wordCount } from '@shared/utils'
import Icon from '../common/Icon'
import type { CompileFormat } from '@shared/types'

interface Props { onClose: () => void }

export default function CompileModal({ onClose }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)

  const [rootId, setRootId] = useState<string>('')
  const [included, setIncluded] = useState<Set<string>>(new Set())
  const [format, setFormat] = useState<CompileFormat>('markdown')
  const [preview, setPreview] = useState('')
  const [compiling, setCompiling] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        return [project.docs[id]?.content?.trim() ?? '']
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

  const handlePrint = () => {
    const title = project.title
    const mdToHtml = (md: string): string => {
      return md
        .split('\n')
        .map((line) => {
          if (line.startsWith('### ')) return `<h3>${line.slice(4)}</h3>`
          if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`
          if (line.startsWith('# ')) return `<h1>${line.slice(2)}</h1>`
          if (line.trim() === '') return '<br>'
          return line
        })
        .join('\n')
        .replace(/\n<br>\n/g, '</p><p>')
    }
    const htmlBody = `<p>${mdToHtml(preview)}</p>`
    const newWin = window.open('', '_blank')
    if (!newWin) { setError('Pop-ups are blocked. Allow pop-ups for this site, then try again.'); return }
    newWin.document.write(`<html><head><title>${title}</title>
<style>body { font-family: Georgia, serif; max-width: 600px; margin: 40px auto; line-height: 1.8; } h1,h2,h3 { margin-top: 2em; }</style>
</head><body>${htmlBody}</body></html>`)
    newWin.document.close()
    setTimeout(() => { newWin.print(); newWin.close() }, 500)
    onClose()
  }

  const handleCompile = async () => {
    if (!rootId || compiling) return
    if (format === 'print') { handlePrint(); return }
    setCompiling(true)
    try {
      const result = await window.api.compile.run(project.id, rootId, [...included], format)
      const mimeType =
        format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
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
          {/* Left: document tree picker */}
          <div style={{ overflowY: 'auto' }}>
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
              <div className="cmp-lbl">Format</div>
              <div className="seg" style={{ display: 'inline-flex' }}>
                <button className={format === 'markdown' ? 'on' : ''} onClick={() => setFormat('markdown')}>Markdown</button>
                <button className={format === 'docx' ? 'on' : ''} onClick={() => setFormat('docx')}>Word (.docx)</button>
                <button className={format === 'epub' ? 'on' : ''} onClick={() => setFormat('epub')}>EPUB</button>
                <button className={format === 'print' ? 'on' : ''} onClick={() => setFormat('print')}>Print / PDF</button>
              </div>
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
            : format === 'docx' ? 'Export .docx'
            : 'Export .md'}
          </button>
        </div>
      </div>
    </div>
  )
}
