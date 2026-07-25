// nodeOps.ts — the single implementation of every structural node mutation.
//
// This logic used to be copy-pasted into all three backends (Browser/OPFS/Node);
// they differed only in how they wrote and deleted doc files. Those two side
// effects are now an injected adapter, so the tree semantics — and the per-node
// revision bookkeeping that cross-device sync depends on — live in exactly one
// place and can't drift between platforms.
//
// Pure w.r.t. DOM and Node: imported by both the renderer and Electron main.

import { uid } from './utils'
import type { Project, KNode, NodeOp, ID } from './types'

/** The only platform-specific parts of applying a node op. */
export interface NodeOpIO {
  writeDoc(nodeId: ID, content: string): Promise<void>
  removeDoc(nodeId: ID): Promise<void>
}

export function descendantIds(p: Project, id: ID): ID[] {
  const acc: ID[] = []
  const walk = (i: ID) => { for (const c of p.nodes[i]?.childIds ?? []) { acc.push(c); walk(c) } }
  walk(id)
  return acc
}

/**
 * Stamp a node as locally modified.
 *
 * `rev` is a Lamport counter, not a plain increment: it's one past the highest
 * revision this project has *seen*, so a node edited on device A always sorts
 * after the version device B started from — without trusting wall clocks, which
 * skew between machines. `modified` is kept for display and as a tiebreak.
 */
export function touchNode(p: Project, id: ID, now = new Date().toISOString()): void {
  const node = p.nodes[id]
  if (!node) return
  node.rev = nextRev(p)
  node.modified = now
}

/**
 * Bring a bundle read off disk up to the current schema, in place.
 *
 * v1 → v2 added per-node `rev`/`modified` (see KNode). Existing nodes are
 * backfilled at rev 1 sharing the project's own `modified` stamp: they all
 * predate any sync, so no ordering between them is claimed. Idempotent, and
 * every backend runs it on open, so an old project just works.
 */
export function migrateProject(p: Project): boolean {
  const version = (p as { schemaVersion?: number }).schemaVersion ?? 1
  if (version >= 2) return false
  const fallback = p.modified || p.created || new Date().toISOString()
  for (const n of Object.values(p.nodes ?? {})) {
    if (typeof n.rev !== 'number') n.rev = 1
    if (!n.modified) n.modified = fallback
  }
  ;(p as { schemaVersion: number }).schemaVersion = 2
  return true
}

/** One past the highest rev anywhere in the project. */
export function nextRev(p: Project): number {
  let max = 0
  for (const n of Object.values(p.nodes)) if (typeof n.rev === 'number' && n.rev > max) max = n.rev
  return max + 1
}

function newNode(id: ID, type: KNode['type'], title: string, parentId: ID | null, rev: number, now: string): KNode {
  return {
    id, type, title, parentId, childIds: [],
    expanded: type === 'folder',
    meta: {
      label: type === 'scene' ? 'scene' : 'none',
      status: 'todo', synopsis: '', target: 0,
      includeInCompile: type !== 'folder',
    },
    ext: { _newId: id },
    rev, modified: now,
  }
}

/**
 * Apply a structural op to `p` in place. Mutating callers are responsible for
 * bumping `p.modified` and persisting the manifest afterwards.
 */
export async function applyNodeOp(p: Project, op: NodeOp, io: NodeOpIO): Promise<void> {
  const now = new Date().toISOString()
  const touch = (id: ID) => touchNode(p, id, now)

  switch (op.type) {
    case 'create': {
      const id = uid(op.nodeType)
      const title = op.title
        ?? (op.nodeType === 'folder' ? 'New Folder' : op.nodeType === 'scene' ? 'New Scene' : 'New Document')
      p.nodes[id] = newNode(id, op.nodeType, title, op.parentId, nextRev(p), now)
      if (op.nodeType !== 'folder') {
        p.docs[id] = { content: '', snapshots: [] }
        await io.writeDoc(id, '')
      }
      if (op.parentId == null) {
        p.rootIds.splice(op.atIndex ?? p.rootIds.length, 0, id)
      } else {
        const parent = p.nodes[op.parentId]
        if (parent) {
          parent.childIds.splice(op.atIndex ?? parent.childIds.length, 0, id)
          parent.expanded = true
          touch(op.parentId)
        }
      }
      break
    }

    case 'rename':
      if (p.nodes[op.id]) { p.nodes[op.id].title = op.title; touch(op.id) }
      break

    case 'setProjectTitle':
      p.title = op.title
      break

    case 'move': {
      const node = p.nodes[op.id]
      if (!node || op.id === op.newParentId) break
      if (op.newParentId != null && descendantIds(p, op.id).includes(op.newParentId)) break
      if (node.parentId == null) p.rootIds = p.rootIds.filter((x) => x !== op.id)
      else { const old = p.nodes[node.parentId]; if (old) { old.childIds = old.childIds.filter((x) => x !== op.id); touch(old.id) } }
      node.parentId = op.newParentId
      if (op.newParentId == null) p.rootIds.splice(op.atIndex, 0, op.id)
      else {
        const np = p.nodes[op.newParentId]
        if (np) { np.childIds.splice(op.atIndex, 0, op.id); np.expanded = true; touch(np.id) }
      }
      touch(op.id)
      break
    }

    case 'duplicate': {
      const cloneRec = async (srcId: ID, parentId: ID | null): Promise<ID> => {
        const src = p.nodes[srcId]
        const nid = uid(src.type)
        p.nodes[nid] = {
          ...src, id: nid, parentId, childIds: [], title: src.title + ' copy',
          meta: { ...src.meta }, ext: { ...src.ext },
          rev: nextRev(p), modified: now,
        }
        if (p.docs[srcId]) {
          const content = p.docs[srcId].content
          p.docs[nid] = { content, snapshots: [] }
          await io.writeDoc(nid, content)
        }
        p.nodes[nid].childIds = await Promise.all(src.childIds.map((c) => cloneRec(c, nid)))
        return nid
      }
      const src = p.nodes[op.id]
      if (!src) break
      const newId = await cloneRec(op.id, src.parentId)
      if (src.parentId == null) { const i = p.rootIds.indexOf(op.id); p.rootIds.splice(i + 1, 0, newId) }
      else {
        const par = p.nodes[src.parentId]
        if (par) { const i = par.childIds.indexOf(op.id); par.childIds.splice(i + 1, 0, newId); touch(par.id) }
      }
      break
    }

    case 'trash': {
      const node = p.nodes[op.id]
      if (!node || !p.trashId || node.parentId === p.trashId) break
      if (node.parentId == null) p.rootIds = p.rootIds.filter((x) => x !== op.id)
      else { const old = p.nodes[node.parentId]; if (old) { old.childIds = old.childIds.filter((x) => x !== op.id); touch(old.id) } }
      node.parentId = p.trashId
      p.nodes[p.trashId].childIds.push(op.id)
      p.nodes[p.trashId].expanded = true
      touch(p.trashId)
      touch(op.id)
      break
    }

    case 'delete': {
      const node = p.nodes[op.id]
      if (!node) break
      const kill = [op.id, ...descendantIds(p, op.id)]
      if (node.parentId == null) p.rootIds = p.rootIds.filter((x) => x !== op.id)
      else { const old = p.nodes[node.parentId]; if (old) { old.childIds = old.childIds.filter((x) => x !== op.id); touch(old.id) } }
      for (const k of kill) {
        await io.removeDoc(k)
        delete p.nodes[k]
        delete p.docs[k]
      }
      break
    }

    case 'updateMeta':
      if (p.nodes[op.id]) { p.nodes[op.id].meta = { ...p.nodes[op.id].meta, ...op.patch }; touch(op.id) }
      break

    case 'setExpanded':
      // Expansion is view state, not content — deliberately does NOT bump rev,
      // so merely opening a folder never wins a sync merge against real edits.
      if (p.nodes[op.id]) p.nodes[op.id].expanded = op.expanded
      break

    case 'setTree':
      // Undo/redo: replace the whole tree. Docs are untouched (content edits are
      // preserved); orphaned doc files from a prior delete aren't revived.
      p.rootIds = op.rootIds
      p.nodes = op.nodes
      break
  }
}
