// SyncService — device identity and per-project sync logs.
//
// Both are *device-local*, so they go through the prefs seam (localStorage in the
// browser, userData in Electron) rather than into the .konbini bundle. Putting
// them in the bundle would be actively harmful: the bundle is what gets synced,
// so whichever device pushed last would overwrite the other's record of the
// common ancestor — the one piece of information the merge needs to distinguish
// "they changed it" from "I changed it".

import type { Project } from '@shared/types'
import { emptySyncLog, makeDeviceId, syncLogFor, type SyncLog } from '@shared/sync'

const DEVICE_KEY = 'sync:deviceId'
const logKey = (projectId: string) => `sync:log:${projectId}`

export const syncService = {
  /** This install's stable id, minted once on first use. */
  deviceId(): string {
    const existing = window.api.prefs.get(DEVICE_KEY)
    if (existing) return existing
    const id = makeDeviceId()
    window.api.prefs.set(DEVICE_KEY, id)
    return id
  },

  /** The last-sync record for a project, or a fresh empty one. */
  getLog(projectId: string): SyncLog {
    const raw = window.api.prefs.get(logKey(projectId))
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as SyncLog
        if (parsed && typeof parsed.baseRev === 'number') return parsed
      } catch { /* fall through to a fresh log */ }
    }
    return emptySyncLog(this.deviceId())
  },

  putLog(projectId: string, log: SyncLog): void {
    window.api.prefs.set(logKey(projectId), JSON.stringify(log))
  },

  /**
   * Record the current state as the new common ancestor. Call this only after a
   * sync has fully succeeded — recording it early would make a later merge
   * believe the other side's unseen edits were already accounted for.
   */
  markSynced(project: Project): SyncLog {
    const log = syncLogFor(project, this.deviceId())
    this.putLog(project.id, log)
    return log
  },

  /**
   * Establish a first ancestor if this project has never been reconciled.
   *
   * Call right after opening a project: the bundle was just read off disk, so
   * memory and disk agree by construction, which is exactly what an ancestor
   * records. Without this the *first* external change a writer ever makes would
   * be reported as a conflict — reconcileDoc has no history to compare against
   * and correctly refuses to guess — which is alarming and needless.
   *
   * Only ever writes when no log exists, so it can't overwrite real history.
   */
  ensureBaseline(project: Project): void {
    const existing = window.api.prefs.get(logKey(project.id))
    if (existing) return
    this.markSynced(project)
  },

  /** Forget a project's ancestor record (e.g. when re-linking a remote). */
  clearLog(projectId: string): void {
    window.api.prefs.remove(logKey(projectId))
  },
}
