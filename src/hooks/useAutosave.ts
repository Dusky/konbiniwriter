import { useEffect, useRef } from 'react'
import { useProjectStore } from '../store/projectStore'
import { historyService } from '../lib/HistoryService'

const DEBOUNCE_MS = 700

export function useAutosave(docId: string | null): void {
  const project = useProjectStore((s) => s.project)
  const setSaveStatus = useProjectStore((s) => s.setSaveStatus)
  const content = docId && project ? (project.docs[docId]?.content ?? '') : null
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevContentRef = useRef<string | null>(null)

  useEffect(() => {
    if (!docId || !project || content === null) return
    if (content === prevContentRef.current) return
    prevContentRef.current = content

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      try {
        await window.api.doc.write(project.id, docId, content)
        setSaveStatus('saved', new Date().toISOString())
        // Accrue a browsable version history as the author writes (throttled).
        historyService.maybeCapture(project.id, docId, content)
      } catch (err) {
        console.error('Autosave failed:', err)
        setSaveStatus('unsaved')
      }
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [content, docId, project?.id])
}
