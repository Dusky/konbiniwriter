import React, { useEffect, useRef, useCallback } from 'react'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { focusModeEffect, konbiniExtensions } from './extensions'
import { useProjectStore } from '../../store/projectStore'
import { useAutosave } from '../../hooks/useAutosave'
import { wordCount, charCount } from '@shared/utils'

const THEMES = [
  { id: 'paper', label: 'Paper', bg: '#f5f3ee', text: '#1a1812' },
  { id: 'dark',  label: 'Dark',  bg: '#14131a', text: '#e8e6e0' },
  { id: 'sepia', label: 'Sepia', bg: '#1c1710', text: '#d4c9a8' },
]

export default function CompositionMode(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const updateContent = useProjectStore((s) => s.updateContent)
  const setSaveStatus = useProjectStore((s) => s.setSaveStatus)
  const setCompositionMode = useProjectStore((s) => s.setCompositionMode)
  const focusMode = useProjectStore((s) => s.focusMode)
  const setFocusMode = useProjectStore((s) => s.setFocusMode)

  const [theme, setTheme] = React.useState(THEMES[1])
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  const content = selectedId && project ? (project.docs[selectedId]?.content ?? '') : ''
  const docNode = selectedId && project ? project.nodes[selectedId] : null

  useAutosave(selectedId)

  const handleChange = useCallback((newContent: string) => {
    if (!selectedId) return
    setSaveStatus('saving')
    updateContent(selectedId, newContent)
  }, [selectedId, updateContent, setSaveStatus])

  useEffect(() => {
    if (!containerRef.current || !selectedId) return
    const state = EditorState.create({
      doc: content,
      extensions: konbiniExtensions(handleChange),
    })
    const view = new EditorView({
      state,
      parent: containerRef.current,
      root: document,
    })
    viewRef.current = view
    view.focus()
    return () => { view.destroy(); viewRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // External content sync
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const cur = view.state.doc.toString()
    if (cur !== content) {
      view.dispatch({ changes: { from: 0, to: cur.length, insert: content } })
    }
  }, [content])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: focusModeEffect.of(focusMode) })
  }, [focusMode])

  // Escape exits composition mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCompositionMode(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setCompositionMode])

  const words = wordCount(content)
  const chars = charCount(content)
  const target = docNode?.meta.target ?? 0

  return (
    <div
      className="comp"
      style={{ '--comp-bg': theme.bg, '--comp-text': theme.text } as React.CSSProperties}
    >
      <div className="comp-top">
        <span style={{ fontWeight: 600, fontSize: 13 }}>{docNode?.title}</span>
        <span style={{ flex: 1 }} />
        {THEMES.map((t) => (
          <button
            key={t.id}
            onClick={() => setTheme(t)}
            style={{
              border: `1px solid ${theme.id === t.id ? 'currentColor' : 'transparent'}`,
              background: t.bg,
              color: t.text,
              width: 20,
              height: 20,
              borderRadius: 4,
              cursor: 'pointer',
            }}
            title={t.label}
          />
        ))}
        <button
          style={{ background: 'transparent', border: '1px solid', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: 'inherit' }}
          onClick={() => setFocusMode(!focusMode)}
        >
          {focusMode ? 'Focus: On' : 'Focus: Off'}
        </button>
        <button className="comp-exit" onClick={() => setCompositionMode(false)}>Exit (Esc)</button>
      </div>

      <div className="comp-scroll">
        <div className="comp-col">
          <div ref={containerRef} style={{ height: '100%', position: 'relative' }} />
        </div>
      </div>

      <div className="comp-foot">
        <span><b>{words.toLocaleString()}</b> words</span>
        {target > 0 && (
          <span><b>{Math.round((words / target) * 100)}%</b> of {target} target</span>
        )}
        <span><b>{chars.toLocaleString()}</b> chars</span>
      </div>
    </div>
  )
}
