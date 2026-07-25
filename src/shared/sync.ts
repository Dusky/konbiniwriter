// sync.ts — device identity, the sync log, and the merge engine.
//
// Transport-agnostic on purpose. Whether bytes arrive via a folder an external
// syncer touched (Dropbox/iCloud/Syncthing), a git remote, or a hosted relay,
// the reconciliation is identical — so it lives here once and every tier reuses
// it. Nothing in this file performs I/O.
//
// The model, in one paragraph: a writer is essentially never editing the same
// scene on two machines at the same instant. The real failure is "I wrote on the
// laptop, forgot to sync, then wrote on the desktop" — divergent versions, not
// interleaved keystrokes. So prose merges per-file against a common ancestor and
// preserves both sides when it can't, and the node tree merges per-node by
// Lamport `rev`. No CRDT: it would change the on-disk representation and break
// the promise that a .konbini doc is a plain .md you can open anywhere.

import type { Project, KNode, ID, ISO } from './types'
import { nextRev } from './nodeOps'

// ── Device identity ──────────────────────────────────────────────────────────

/** Stable per-install id. Sync needs to tell "my last write" from "theirs". */
export function makeDeviceId(): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `dev-${Date.now().toString(36)}-${rand}`
}

// ── Sync log ─────────────────────────────────────────────────────────────────

/**
 * What *this device* knows about the last successful sync.
 *
 * `baseRev`/`baseDocHashes` are the common ancestor: without them a merge can't
 * tell "they changed it" from "I changed it", and would have to fall back to
 * preserving both every single time.
 *
 * Deliberately device-local (see SyncService — it lives in prefs, keyed by
 * project) and NOT inside the bundle: the bundle is the thing being synced, so a
 * log stored there would be overwritten by whichever device pushed last,
 * destroying the very ancestor record the merge depends on.
 */
export interface SyncLog {
  deviceId: string
  lastSyncAt: ISO | null
  /** Highest node rev present at the last sync. */
  baseRev: number
  /** docId → content hash at the last sync. */
  baseDocHashes: Record<ID, string>
}

export function emptySyncLog(deviceId = makeDeviceId()): SyncLog {
  return { deviceId, lastSyncAt: null, baseRev: 0, baseDocHashes: {} }
}

/**
 * Cheap, stable content hash (FNV-1a, 32-bit, hex). Not cryptographic — it only
 * has to answer "did this document change since the last sync", and it must
 * produce identical output on every platform, which rules out anything async.
 */
export function hashContent(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function syncLogFor(project: Project, deviceId: string, at = new Date().toISOString()): SyncLog {
  const baseDocHashes: Record<ID, string> = {}
  for (const [id, body] of Object.entries(project.docs)) baseDocHashes[id] = hashContent(body.content ?? '')
  return { deviceId, lastSyncAt: at, baseRev: nextRev(project) - 1, baseDocHashes }
}

// ── Document reconciliation ──────────────────────────────────────────────────

export type DocOutcome =
  /** Nobody touched it, or both sides already agree. */
  | { kind: 'unchanged'; content: string }
  /** Only one side moved; take it. */
  | { kind: 'fast-forward'; content: string; from: 'local' | 'remote' }
  /** Both sides moved. `content` is what to keep; `preserve` is written beside it. */
  | { kind: 'conflict'; content: string; preserve: string }

/**
 * Decide what a single document should become.
 *
 * The ancestor hash is what makes this safe. With it we can distinguish a real
 * two-sided divergence (genuine conflict) from a one-sided edit (safe
 * fast-forward). Without it, every difference would look like a conflict.
 *
 * A conflict never discards: the local text is kept in place and the remote is
 * handed back in `preserve` so the caller can drop it next to the document as a
 * `.conflict-<stamp>.md` — the convention the app already uses for external
 * edits — and offer it through the changeset review UI.
 */
export function reconcileDoc(local: string, remote: string, baseHash?: string): DocOutcome {
  if (local === remote) return { kind: 'unchanged', content: local }

  const localHash = hashContent(local)
  const remoteHash = hashContent(remote)

  // No known ancestor: we cannot prove which side moved, so never guess.
  if (baseHash === undefined) return { kind: 'conflict', content: local, preserve: remote }

  const localChanged = localHash !== baseHash
  const remoteChanged = remoteHash !== baseHash

  if (!localChanged && remoteChanged) return { kind: 'fast-forward', content: remote, from: 'remote' }
  if (localChanged && !remoteChanged) return { kind: 'fast-forward', content: local, from: 'local' }
  if (!localChanged && !remoteChanged) return { kind: 'unchanged', content: local }
  return { kind: 'conflict', content: local, preserve: remote }
}

// ── Node-tree reconciliation ─────────────────────────────────────────────────

export interface NodeMergeResult {
  nodes: Record<ID, KNode>
  rootIds: ID[]
  /** Node ids taken from the remote side (for reporting). */
  tookRemote: ID[]
  /** Node ids present locally but gone remotely, treated as remote deletions. */
  deleted: ID[]
}

/**
 * Merge two node trees per-node instead of whole-file.
 *
 * Only viable because node IDs are stable and never reused (invariant 6): a node
 * present on both sides is definitionally the same node, so the higher Lamport
 * `rev` wins, with `modified` as a tiebreak for the rare equal-rev case.
 *
 * Deletion is the genuinely ambiguous case, and we resolve it conservatively:
 * a node missing remotely is only dropped when it hasn't been edited locally
 * since the last sync (`rev <= baseRev`). Otherwise the local edit wins and the
 * node survives — losing someone's new scene to a stale delete is far worse
 * than a resurrected folder they can delete again.
 */
export function mergeNodes(
  local: { nodes: Record<ID, KNode>; rootIds: ID[] },
  remote: { nodes: Record<ID, KNode>; rootIds: ID[] },
  baseRev: number,
): NodeMergeResult {
  const nodes: Record<ID, KNode> = {}
  const tookRemote: ID[] = []
  const deleted: ID[] = []

  const ids = new Set([...Object.keys(local.nodes), ...Object.keys(remote.nodes)])
  for (const id of ids) {
    const l = local.nodes[id]
    const r = remote.nodes[id]

    if (l && !r) {
      // Missing remotely: a delete we haven't seen, or a local creation they
      // haven't seen yet. Local edits since the last sync win.
      if ((l.rev ?? 0) > baseRev) nodes[id] = l
      else deleted.push(id)
      continue
    }
    if (!l && r) { nodes[id] = r; tookRemote.push(id); continue }
    if (!l || !r) continue

    const lRev = l.rev ?? 0
    const rRev = r.rev ?? 0
    if (rRev > lRev) { nodes[id] = r; tookRemote.push(id) }
    else if (lRev > rRev) { nodes[id] = l }
    else if ((r.modified ?? '') > (l.modified ?? '')) { nodes[id] = r; tookRemote.push(id) }
    else { nodes[id] = l }
  }

  // Drop child references to nodes that didn't survive, so the tree stays valid.
  // Clone first: the winners above are the caller's own node objects, so pruning
  // in place would mutate the local project — and planMerge promises not to.
  const alive = (id: ID) => nodes[id] !== undefined
  for (const [id, n] of Object.entries(nodes)) {
    nodes[id] = { ...n, childIds: n.childIds.filter(alive) }
  }

  // Root order: keep local order, append roots only the remote knows about.
  const rootIds = [
    ...local.rootIds.filter(alive),
    ...remote.rootIds.filter((id) => alive(id) && !local.rootIds.includes(id)),
  ]

  return { nodes, rootIds, tookRemote, deleted }
}

// ── Whole-bundle plan ────────────────────────────────────────────────────────

export interface DocPlan { docId: ID; outcome: DocOutcome }

export interface MergePlan {
  nodes: NodeMergeResult
  docs: DocPlan[]
  /** True when any document needs a .conflict file written. */
  hasConflicts: boolean
}

/**
 * Build a complete, side-effect-free plan for reconciling a remote bundle into
 * the local one. Returning a plan rather than applying it means the caller can
 * snapshot first (the pre-AI snapshot invariant, extended to sync) and can show
 * the writer exactly what is about to happen before anything is written.
 */
export function planMerge(
  local: Project,
  remote: { nodes: Record<ID, KNode>; rootIds: ID[]; docs: Record<ID, { content: string }> },
  log: SyncLog,
): MergePlan {
  const nodes = mergeNodes(local, remote, log.baseRev)

  const docs: DocPlan[] = []
  const docIds = new Set([...Object.keys(local.docs), ...Object.keys(remote.docs)])
  for (const docId of docIds) {
    if (!nodes.nodes[docId] && !local.docs[docId]) continue   // node didn't survive
    const l = local.docs[docId]?.content
    const r = remote.docs[docId]?.content
    if (l === undefined && r === undefined) continue
    if (l === undefined) { docs.push({ docId, outcome: { kind: 'fast-forward', content: r!, from: 'remote' } }); continue }
    if (r === undefined) { docs.push({ docId, outcome: { kind: 'unchanged', content: l } }); continue }
    docs.push({ docId, outcome: reconcileDoc(l, r, log.baseDocHashes[docId]) })
  }

  return { nodes, docs, hasConflicts: docs.some((d) => d.outcome.kind === 'conflict') }
}

/** Filename for a preserved divergent copy, matching the existing convention. */
export function conflictFileName(docId: ID, at = new Date()): string {
  return `${docId}.conflict-${at.toISOString().replace(/[:.]/g, '-')}.md`
}
