import React, { useEffect, useRef, useCallback, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { focusModeEffect, konbiniExtensions, setSlopSpansEffect, type SlopSpan } from './extensions'
import { useProjectStore } from '../../store/projectStore'
import { useAutosave } from '../../hooks/useAutosave'
import { useAIStore } from '../../store/aiStore'
import CowriteBar from './CowriteBar'
import { promptRegistry } from '../../lib/PromptRegistry'
import { streamCompletion } from '../../lib/AIClient'

interface Props {
  docId: string
}

export default function Editor({ docId }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  const project = useProjectStore((s) => s.project)
  const updateContent = useProjectStore((s) => s.updateContent)
  const setSaveStatus = useProjectStore((s) => s.setSaveStatus)
  const focusMode = useProjectStore((s) => s.focusMode)
  const aiEnabled = useAIStore((s) => s.enabled)
  const setSlopSpans = useProjectStore((s) => s.setSlopSpans)
  const setSlopRunning = useProjectStore((s) => s.setSlopRunning)

  const content = project?.docs[docId]?.content ?? ''

  const [cowrite, setCowrite] = useState<{ selection: string; anchorRect: DOMRect } | null>(null)
  const [wikilinkTip, setWikilinkTip] = useState<{ title: string; synopsis: string; preview: string; x: number; y: number } | null>(null)

  // Run slop proof on current doc — called from Toolbar
  const runProof = useCallback(async () => {
    const view = viewRef.current
    if (!view || !aiEnabled) return
    const text = view.state.doc.toString()
    if (!text.trim()) return

    setSlopRunning(true)
    const template = promptRegistry.get('builtin:evaluation:slop')
    if (!template) { setSlopRunning(false); return }
    const rendered = promptRegistry.render('builtin:evaluation:slop', { content: text })

    let full = ''
    await streamCompletion(
      [{ role: 'user', content: rendered }],
      { model: template.model, maxTokens: template.maxTokens, temperature: template.temperature },
      {
        onChunk: (c) => { full += c },
        onDone: (result) => {
          try {
            const raw = result.match(/\[[\s\S]*\]/)?.[0] ?? '[]'
            const flags = JSON.parse(raw) as Array<{ excerpt: string; reason: string; severity: 'low' | 'medium' | 'high' }>
            const spans: SlopSpan[] = []
            for (const flag of flags) {
              let idx = 0
              while (idx < text.length) {
                const pos = text.indexOf(flag.excerpt, idx)
                if (pos === -1) break
                spans.push({ from: pos, to: pos + flag.excerpt.length, reason: flag.reason, severity: flag.severity })
                idx = pos + flag.excerpt.length
              }
            }
            setSlopSpans(spans)
            if (view) view.dispatch({ effects: setSlopSpansEffect.of(spans) })
          } catch {
            setSlopSpans([])
          }
        },
        onError: () => setSlopRunning(false),
      },
    )
  }, [aiEnabled, setSlopSpans, setSlopRunning])

  // Expose runProof globally so Toolbar can call it without prop drilling
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__konbiniRunProof = runProof
    return () => { delete (window as unknown as Record<string, unknown>).__konbiniRunProof }
  }, [runProof])

  // Autosave hook — fires 700ms after content changes
  useAutosave(docId)

  const handleChange = useCallback(
    (newContent: string) => {
      setSaveStatus('saving')
      updateContent(docId, newContent)
    },
    [docId, updateContent, setSaveStatus]
  )

  // Show co-write bar on mouseup if there's a selection and AI is enabled
  const handleMouseUp = useCallback(() => {
    if (!aiEnabled) return
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    if (from === to) { setCowrite(null); return }
    const selection = view.state.doc.sliceString(from, to).trim()
    if (selection.length < 3) { setCowrite(null); return }
    // Get bounding rect of selection anchor
    const coords = view.coordsAtPos(from)
    if (!coords) { setCowrite(null); return }
    setCowrite({ selection, anchorRect: new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top) })
  }, [aiEnabled])

  // Mount / remount when docId changes
  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: content,
      extensions: konbiniExtensions(handleChange),
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view

    // Focus the editor
    view.focus()

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Intentionally only re-run when docId changes (not content)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  // Sync external content changes (snapshot restore) without recreating the view
  const prevDocIdRef = useRef(docId)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    // Skip on initial mount (handled above)
    if (prevDocIdRef.current !== docId) { prevDocIdRef.current = docId; return }
    const current = view.state.doc.toString()
    if (current !== content) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content },
      })
    }
  }, [content, docId])

  // Wikilink hover tooltip
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const view = viewRef.current
    if (!view || !project) { setWikilinkTip(null); return }
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
    if (pos === null) { setWikilinkTip(null); return }
    const text = view.state.doc.toString()
    const re = /\[\[([^\]]+)\]\]/g
    let m: RegExpExecArray | null
    let found: string | null = null
    while ((m = re.exec(text)) !== null) {
      if (m.index <= pos && pos <= m.index + m[0].length) { found = m[1]; break }
    }
    if (!found) { setWikilinkTip(null); return }
    const target = Object.values(project.nodes).find(
      (n) => n.title.toLowerCase() === found!.toLowerCase()
    )
    if (!target) { setWikilinkTip(null); return }
    const preview = (project.docs[target.id]?.content ?? '').slice(0, 200).trim()
    setWikilinkTip({ title: target.title, synopsis: target.meta.synopsis, preview, x: e.clientX, y: e.clientY })
  }, [project])

  // Sync focus mode into CM6 state field
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: focusModeEffect.of(focusMode) })
  }, [focusMode])

  return (
    <div style={{ height: '100%', position: 'relative' }} onMouseUp={handleMouseUp} onMouseMove={handleMouseMove} onMouseLeave={() => setWikilinkTip(null)}>
      <div ref={containerRef} style={{ height: '100%' }} />
      {wikilinkTip && (
        <div style={{
          position: 'fixed', left: wikilinkTip.x + 12, top: wikilinkTip.y + 12,
          background: 'var(--ui-2)', border: '1px solid var(--ui-4)', borderRadius: 6,
          padding: '10px 12px', maxWidth: 280, zIndex: 9000, pointerEvents: 'none',
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)', fontSize: 13, lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--accent)' }}>{wikilinkTip.title}</div>
          {wikilinkTip.synopsis && <div style={{ color: 'var(--text-2)', marginBottom: 4, fontStyle: 'italic' }}>{wikilinkTip.synopsis}</div>}
          {wikilinkTip.preview && <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{wikilinkTip.preview}{wikilinkTip.preview.length >= 200 ? '…' : ''}</div>}
        </div>
      )}
      {cowrite && (
        <CowriteBar
          docId={docId}
          selection={cowrite.selection}
          anchorRect={cowrite.anchorRect}
          onClose={() => setCowrite(null)}
        />
      )}
    </div>
  )
}
