import React, { useState, useEffect } from 'react'
import { useProjectStore, descendants } from '../../store/projectStore'
import { wordCount } from '@shared/utils'
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

  const handleCompile = async () => {
    if (!rootId || compiling) return
    setCompiling(true)
    try {
      const result = await window.api.compile.run(project.id, rootId, [...included], format)
      const blob = new Blob([new Uint8Array(result.blob)], {
        type: format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/markdown',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = result.filename
      a.click()
      URL.revokeObjectURL(url)
      onClose()
    } catch (err) {
      alert(`Compile failed: ${err}`)
    } finally {
      setCompiling(false)
    }
  }

  const totalWords = [...included].reduce((acc, id) => acc + wordCount(project.docs[id]?.content ?? ''), 0)

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-hd">
          <h3>Compile</h3>
          <span className="sub">{included.size} documents · {totalWords.toLocaleString()} words</span>
        </div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, minHeight: 340 }}>
          {/* Left: document tree picker */}
          <div style={{ overflowY: 'auto' }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>Documents</div>
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
                <div style={{ color: 'var(--text-3)', fontSize: 12 }}>No documents.</div>
              )}
            </div>
          </div>

          {/* Right: format + preview */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>Format</div>
              <div className="seg" style={{ display: 'inline-flex' }}>
                <button className={format === 'markdown' ? 'on' : ''} onClick={() => setFormat('markdown')}>Markdown</button>
                <button className={format === 'docx' ? 'on' : ''} onClick={() => setFormat('docx')}>Word (.docx)</button>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>Preview</div>
              <div className="compile-preview">{preview || '(no content)'}</div>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <span className="tb-spacer" />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={handleCompile} disabled={compiling || included.size === 0}>
            {compiling ? 'Compiling…' : `Export ${format === 'docx' ? '.docx' : '.md'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
