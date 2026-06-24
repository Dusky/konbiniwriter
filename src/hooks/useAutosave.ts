import { useEffect, useRef } from 'react'
import { useProjectStore } from '../store/projectStore'
import { historyService } from '../lib/HistoryService'

const DEBOUNCE_MS = 700

interface Pending {
  projectId: string
  docId: string
  content: string
  timer: ReturnType<typeof setTimeout>
}

export function useAutosave(docId: string | null): void {
  const project = useProjectStore((s) => s.project)
  const setSaveStatus = useProjectStore((s) => s.setSaveStatus)
  const content = docId && project ? (project.docs[docId]?.content ?? '') : null
  const prevContentRef = useRef<Record<string, string>>({})
  const pendingRef = useRef<Pending | null>(null)

  const writeNowRef = useRef<(projectId: string, dId: string, c: string) => Promise<void>>()
  writeNowRef.current = async (projectId, dId, c) => {
    try {
      await window.api.doc.write(projectId, dId, c)
      setSaveStatus('saved', new Date().toISOString())
      // Accrue a browsable version history as the author writes (throttled).
      historyService.maybeCapture(projectId, dId, c)
    } catch (err) {
      console.error('Autosave failed:', err)
      setSaveStatus('error')
    }
  }

  // Flush any pending debounced write immediately (used on doc switch and unmount,
  // so a write that's still debouncing for the doc being left isn't dropped).
  const flushPending = () => {
    const p = pendingRef.current
    if (!p) return
    clearTimeout(p.timer)
    pendingRef.current = null
    void writeNowRef.current?.(p.projectId, p.docId, p.content)
  }

  useEffect(() => {
    if (!docId || !project || content === null) return
    if (prevContentRef.current[docId] === content) return
    prevContentRef.current[docId] = content

    if (pendingRef.current?.docId !== docId) {
      flushPending()
    } else {
      clearTimeout(pendingRef.current.timer)
      pendingRef.current = null
    }

    const projectId = project.id
    const timer = setTimeout(() => {
      const p = pendingRef.current
      pendingRef.current = null
      if (p) void writeNowRef.current?.(p.projectId, p.docId, p.content)
    }, DEBOUNCE_MS)

    pendingRef.current = { projectId, docId, content, timer }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, docId, project?.id])

  // Flush on unmount (e.g. closing the project) rather than dropping the last edit.
  useEffect(() => () => flushPending(), [])
}
