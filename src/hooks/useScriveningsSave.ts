import { useEffect, useRef } from 'react'
import { useProjectStore } from '../store/projectStore'
import { historyService } from '../lib/HistoryService'

const DEBOUNCE_MS = 700

// Batched multi-doc autosave for Scrivenings. Unlike useAutosave (one docId), the
// combined buffer can dirty several scenes at once; this collects the pending
// per-node content and flushes each to its own docs/{id}.md, driving the single
// global saveStatus. Returns a `stage(id, content)` to enqueue a changed scene.
export function useScriveningsSave(): (id: string, content: string) => void {
  const setSaveStatus = useProjectStore((s) => s.setSaveStatus)
  const projectId = useProjectStore((s) => s.project?.id ?? null)

  const dirtyRef = useRef<Map<string, string>>(new Map())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId

  const flush = useRef<() => void>()
  flush.current = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    const pid = projectIdRef.current
    const pending = dirtyRef.current
    if (!pid || pending.size === 0) return
    dirtyRef.current = new Map()
    void (async () => {
      try {
        for (const [id, content] of pending) {
          await window.api.doc.write(pid, id, content)
          historyService.maybeCapture(pid, id, content)
        }
        setSaveStatus('saved', new Date().toISOString())
      } catch (err) {
        console.error('Scrivenings autosave failed:', err)
        setSaveStatus('error')
      }
    })()
  }

  const stage = (id: string, content: string) => {
    dirtyRef.current.set(id, content)
    setSaveStatus('saving')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => flush.current?.(), DEBOUNCE_MS)
  }

  // Flush pending edits on unmount (folder switch / project close) so no
  // keystrokes are dropped.
  useEffect(() => () => flush.current?.(), [])

  return stage
}
