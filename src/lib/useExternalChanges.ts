import { useEffect, useRef } from 'react'
import { useProjectStore } from '../store/projectStore'
import { useShellStore } from '../store/shellStore'
import { syncService } from './SyncService'
import { planMerge } from '@shared/sync'

/**
 * Notice when something outside this window changed the bundle.
 *
 * Two-stage on purpose. `probe()` is a cheap mtime scan and is the common case
 * — nothing moved, so we stop there. Only when it differs do we pay for a full
 * read and a merge plan.
 *
 * That second stage isn't just an optimisation, it's what makes this correct:
 * our *own* autosaves bump mtimes too, so the probe alone would cry wolf every
 * time the writer typed. planMerge compares against the recorded ancestor and
 * reports a doc we ourselves just wrote as unchanged, so only genuine external
 * divergence ever reaches the writer.
 *
 * Checks on window focus and tab visibility — the moments a writer plausibly
 * returns from another machine or another app — rather than polling on a timer.
 */
export function useExternalChanges(): void {
  const lastProbe = useRef<Record<string, number> | null>(null)
  const busy = useRef(false)
  const notifiedFor = useRef<string | null>(null)

  useEffect(() => {
    const check = async () => {
      const project = useProjectStore.getState().project
      if (!project || busy.current) return
      busy.current = true
      try {
        const probe = await window.api.sync.probe(project.id)
        const key = JSON.stringify(probe)
        const prev = lastProbe.current ? JSON.stringify(lastProbe.current) : null
        lastProbe.current = probe
        if (prev === null || prev === key) return          // first look, or nothing moved

        // Something's mtime changed — could be us. Ask the merge engine.
        const bundle = await window.api.sync.readBundle(project.id)
        const plan = planMerge(project, bundle, syncService.getLog(project.id))
        const realChanges =
          plan.docs.some((d) => d.outcome.kind !== 'unchanged') ||
          plan.nodes.tookRemote.length > 0 ||
          plan.nodes.deleted.length > 0
        if (!realChanges) return

        // Don't nag repeatedly about the same on-disk state.
        if (notifiedFor.current === key) return
        notifiedFor.current = key

        const n = plan.docs.filter((d) => d.outcome.kind !== 'unchanged').length
        const conflicts = plan.docs.filter((d) => d.outcome.kind === 'conflict').length
        useShellStore.getState().setToast(
          conflicts > 0
            ? `This project changed on disk — ${conflicts} document${conflicts === 1 ? '' : 's'} diverged. Open Sync to reconcile.`
            : `This project changed on disk (${n} document${n === 1 ? '' : 's'}). Open Sync to bring them in.`,
          'info',
        )
      } catch {
        // A probe failing (bundle moved, permission lapsed) shouldn't disturb writing.
      } finally {
        busy.current = false
      }
    }

    const onVisible = () => { if (!document.hidden) void check() }
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', onVisible)
    void check()   // establish the initial fingerprint
    return () => {
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
}
