// HistoryService — automatic document versioning.
//
// Layered on top of the existing snapshot infrastructure: it periodically
// captures an `'auto'`-kind snapshot of a document as the author writes, so a
// browsable version history accrues without anyone pressing "Take Snapshot".
//
// Captures are throttled by BOTH a word-change threshold and a minimum time
// gap, so steady typing produces a sane cadence of versions rather than noise.
// Manual snapshots remain the explicit, named save-points; auto versions are
// the safety-net timeline behind them.

import { wordCount } from '@shared/utils'
import { useProjectStore } from '../store/projectStore'
import { useShellStore } from '../store/shellStore'

const WORD_DELTA = 30                 // words changed since last version to trigger
const MIN_INTERVAL_MS = 3 * 60 * 1000 // never more than one auto-version / 3 min / doc

interface DocTrack { baselineWords: number; lastAt: number }

class HistoryService {
  private tracks = new Map<string, DocTrack>()

  private track(key: string, words: number): DocTrack {
    let t = this.tracks.get(key)
    if (!t) { t = { baselineWords: words, lastAt: 0 }; this.tracks.set(key, t) }
    return t
  }

  /**
   * Called after each autosave. Captures an auto-version when the document has
   * drifted far enough from the last captured baseline and enough time has
   * passed. No-ops otherwise (the common case).
   */
  async maybeCapture(projectId: string, nodeId: string, content: string): Promise<void> {
    if (!useShellStore.getState().autoVersion) return

    const key = `${projectId}:${nodeId}`
    const words = wordCount(content)
    const t = this.track(key, words)
    const now = Date.now()

    if (Math.abs(words - t.baselineWords) < WORD_DELTA) return
    if (t.lastAt && now - t.lastAt < MIN_INTERVAL_MS) return

    // Reserve the slot before the async call so a burst of saves can't
    // double-capture while the write is in flight.
    t.baselineWords = words
    t.lastAt = now
    try {
      const snap = await window.api.snapshot.take(projectId, nodeId, '', 'auto')
      useProjectStore.getState().addSnapshot(nodeId, snap)
      await this.prune(projectId, nodeId)
    } catch (e) {
      console.error('Auto-version failed:', e)
    }
  }

  /**
   * Drop auto-versions older than the retention window for a document. Manual
   * snapshots (and older bundles' kind-less snapshots) are never pruned.
   */
  private async prune(projectId: string, nodeId: string): Promise<void> {
    const days = useShellStore.getState().historyRetentionDays
    if (!days || days <= 0) return // 0 = keep forever
    const cutoff = Date.now() - days * 86_400_000
    const store = useProjectStore.getState()
    const snaps = store.project?.docs[nodeId]?.snapshots ?? []
    const stale = snaps.filter((s) => s.kind === 'auto' && new Date(s.takenAt).getTime() < cutoff)
    for (const s of stale) {
      try {
        await window.api.snapshot.delete(projectId, nodeId, s.id)
        store.removeSnapshot(nodeId, s.id)
      } catch { /* best-effort */ }
    }
  }
}

export const historyService = new HistoryService()
