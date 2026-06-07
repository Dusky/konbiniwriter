import React, { useEffect, useRef, useCallback, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { focusModeEffect, konbiniExtensions } from './extensions'
import { useProjectStore } from '../../store/projectStore'
import { useAutosave } from '../../hooks/useAutosave'
import { useAIStore } from '../../store/aiStore'
import CowriteBar from './CowriteBar'

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

  const content = project?.docs[docId]?.content ?? ''

  const [cowrite, setCowrite] = useState<{ selection: string; anchorRect: DOMRect } | null>(null)

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

  // Sync focus mode into CM6 state field
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: focusModeEffect.of(focusMode) })
  }, [focusMode])

  return (
    <div style={{ height: '100%', position: 'relative' }} onMouseUp={handleMouseUp}>
      <div ref={containerRef} style={{ height: '100%' }} />
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
