import React, { useState } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
import { syncService } from '../../lib/SyncService'
import { planMerge, type MergePlan } from '@shared/sync'
import type { SyncMerged } from '@shared/types'
import ModalShell from '../common/ModalShell'
import Icon from '../common/Icon'

interface Props { onClose: () => void; embedded?: boolean }

/**
 * Tier 0 sync: keep a bundle safe when something *else* is syncing the folder
 * (Dropbox, iCloud, Syncthing, a git pull). Those tools do whole-file
 * last-writer-wins, which quietly destroys work; this re-reads the bundle,
 * reconciles it against what we hold, and never discards a divergent version.
 */
export default function SyncPanel({ onClose, embedded }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const loadProject = useProjectStore((s) => s.loadProject)
  const addSnapshot = useProjectStore((s) => s.addSnapshot)
  const setToast = useShellStore((s) => s.setToast)

  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)
  const [plan, setPlan] = useState<MergePlan | null>(null)
  const [remote, setRemote] = useState<Awaited<ReturnType<typeof window.api.sync.readBundle>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const log = project ? syncService.getLog(project.id) : null

  const check = async () => {
    if (!project) return
    setChecking(true); setError(null); setDone(null); setPlan(null)
    try {
      const bundle = await window.api.sync.readBundle(project.id)
      setRemote(bundle)
      const next = planMerge(project, bundle, syncService.getLog(project.id))
      // Nothing to reconcile means disk and memory agree — a legitimate
      // ancestor, so record it rather than making the next change look divergent.
      if (!next.docs.some((d) => d.outcome.kind !== 'unchanged')
          && next.nodes.tookRemote.length === 0 && next.nodes.deleted.length === 0) {
        syncService.markSynced(project)
      }
      setPlan(next)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setChecking(false)
    }
  }

  const apply = async () => {
    if (!project || !plan || !remote) return
    setApplying(true); setError(null)
    try {
      // Snapshot every document we're about to change before touching it —
      // the same guarantee the AI proposal pipeline gives.
      for (const d of plan.docs) {
        if (d.outcome.kind === 'unchanged') continue
        const current = project.docs[d.docId]?.content
        if (current === undefined || current === d.outcome.content) continue
        const snap = await window.api.snapshot.take(project.id, d.docId, 'Before sync')
        addSnapshot(d.docId, snap)
      }

      const merged: SyncMerged = {
        rootIds: plan.nodes.rootIds,
        nodes: plan.nodes.nodes,
        docs: Object.fromEntries(plan.docs.map((d) => [d.docId, d.outcome.content])),
        conflicts: Object.fromEntries(
          plan.docs
            .filter((d) => d.outcome.kind === 'conflict')
            .map((d) => [d.docId, (d.outcome as { preserve: string }).preserve]),
        ),
      }
      const files = await window.api.sync.applyMerge(project.id, merged)

      // Reload from disk so the store reflects exactly what was persisted.
      const fresh = await window.api.project.open(project.settings.location)
      loadProject(fresh)
      syncService.markSynced(fresh)

      setPlan(null)
      setDone(files.length
        ? `Merged. ${files.length} conflicting version${files.length === 1 ? '' : 's'} preserved in docs/ — nothing was lost.`
        : 'Merged cleanly.')
      setToast(files.length ? `Sync merged with ${files.length} preserved conflict(s)` : 'Sync merged cleanly', 'info')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setApplying(false)
    }
  }

  const changed = plan
    ? plan.docs.filter((d) => d.outcome.kind !== 'unchanged')
    : []
  const conflicts = changed.filter((d) => d.outcome.kind === 'conflict')
  const treeChanges = plan ? plan.nodes.tookRemote.length + plan.nodes.deleted.length : 0
  const nothingToDo = !!plan && changed.length === 0 && treeChanges === 0

  const title = (id: string) => project?.nodes[id]?.title ?? id

  return (
    <ModalShell embedded={embedded} onClose={onClose} maxWidth={620} label="Sync">
      <div className="modal-hd" style={{ gap: 10, alignItems: 'baseline' }}>
        <h3>Sync</h3>
        <span className="sub">reconcile changes made outside this window</span>
        <span className="tb-spacer" style={{ flex: 1 }} />
        <button className="btn sm" onClick={check} disabled={checking || applying || !project}>
          {checking ? 'Checking…' : 'Check for changes'}
        </button>
      </div>

      <div className="modal-body">
        {!project ? (
          <div className="dock-empty">Open a project first.</div>
        ) : (
          <>
            <p className="hint" style={{ marginTop: 0 }}>
              Keep this bundle safe inside Dropbox, iCloud Drive, Syncthing, or a git
              checkout. Those sync whole files and let the last writer win; Konbini
              reconciles per document and preserves anything that diverged.
            </p>
            <div className="sync-meta">
              <span>Device <code>{syncService.deviceId()}</code></span>
              <span>
                {log?.lastSyncAt
                  ? `Last reconciled ${new Date(log.lastSyncAt).toLocaleString()}`
                  : 'Baseline recorded when this project opened — changes made on disk since then reconcile cleanly.'}
              </span>
            </div>

            {error && <div className="beat-err" style={{ marginTop: 10 }}>{error}</div>}
            {done && <div className="sync-ok">{done}</div>}

            {nothingToDo && <div className="sync-ok">Already up to date — the bundle on disk matches this window.</div>}

            {plan && !nothingToDo && (
              <>
                <div className="sync-summary">
                  <span><b>{changed.length}</b> document{changed.length === 1 ? '' : 's'} to update</span>
                  {treeChanges > 0 && <span><b>{treeChanges}</b> structure change{treeChanges === 1 ? '' : 's'}</span>}
                  {conflicts.length > 0 && <span className="warn"><b>{conflicts.length}</b> conflict{conflicts.length === 1 ? '' : 's'}</span>}
                </div>

                <div className="sync-list">
                  {changed.map((d) => (
                    <div key={d.docId} className="sync-row">
                      <Icon
                        name={d.outcome.kind === 'conflict' ? 'warning' : 'document'}
                        size={13}
                        style={{ color: d.outcome.kind === 'conflict' ? 'var(--danger)' : 'var(--text-3)' }}
                      />
                      <span className="sync-title">{title(d.docId)}</span>
                      <span className={`sync-tag${d.outcome.kind === 'conflict' ? ' conflict' : ''}`}>
                        {d.outcome.kind === 'conflict'
                          ? 'both changed — theirs kept as .conflict'
                          : d.outcome.kind === 'fast-forward'
                            ? (d.outcome.from === 'remote' ? 'updated from disk' : 'yours is newer')
                            : ''}
                      </span>
                    </div>
                  ))}
                  {plan.nodes.deleted.map((id) => (
                    <div key={`del-${id}`} className="sync-row">
                      <Icon name="trash" size={13} style={{ color: 'var(--text-3)' }} />
                      <span className="sync-title">{title(id)}</span>
                      <span className="sync-tag">removed on disk</span>
                    </div>
                  ))}
                </div>

                {conflicts.length > 0 && (
                  <p className="hint">
                    Conflicting versions are written next to the document as
                    <code> .conflict-…md</code> files. Nothing is overwritten without a
                    snapshot first.
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>

      <div className="modal-foot">
        <span className="hint">
          {plan && !nothingToDo ? 'Every changed document is snapshotted before it is written.' : ''}
        </span>
        <span className="tb-spacer" />
        {!embedded && <button className="btn" onClick={onClose}>Close</button>}
        <button
          className="btn primary"
          onClick={apply}
          disabled={!plan || nothingToDo || applying}
        >
          {applying ? 'Merging…' : 'Merge'}
        </button>
      </div>
    </ModalShell>
  )
}
