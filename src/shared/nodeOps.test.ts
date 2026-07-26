import { describe, it, expect } from 'vitest'
import { applyNodeOp, migrateProject, nextRev, touchNode, outermost, type NodeOpIO } from './nodeOps'
import { buildProjectFromTemplate } from './templates'
import type { Project, ID } from './types'

function io(): NodeOpIO & { wrote: ID[]; removed: ID[] } {
  const wrote: ID[] = [], removed: ID[] = []
  return {
    wrote, removed,
    writeDoc: async (id) => { wrote.push(id) },
    removeDoc: async (id) => { removed.push(id) },
  }
}

const proj = (): Project => buildProjectFromTemplate('T', 'novel', '/tmp')
const firstDoc = (p: Project): ID => Object.values(p.nodes).find((n) => n.type !== 'folder')!.id

describe('rev bookkeeping', () => {
  it('nextRev is one past the highest rev in the project', () => {
    const p = proj()
    const start = nextRev(p)
    touchNode(p, firstDoc(p))
    expect(p.nodes[firstDoc(p)].rev).toBe(start)
    expect(nextRev(p)).toBe(start + 1)
  })

  it('a rename bumps rev and modified on that node only', async () => {
    const p = proj()
    const id = firstDoc(p)
    const other = Object.values(p.nodes).find((n) => n.id !== id)!.id
    const beforeOther = p.nodes[other].rev
    const beforeRev = p.nodes[id].rev
    await applyNodeOp(p, { type: 'rename', id, title: 'Renamed' }, io())
    expect(p.nodes[id].title).toBe('Renamed')
    expect(p.nodes[id].rev).toBeGreaterThan(beforeRev)
    expect(p.nodes[other].rev).toBe(beforeOther)
  })

  it('every local edit produces a strictly increasing rev (so sync can order them)', async () => {
    const p = proj()
    const id = firstDoc(p)
    const seen: number[] = []
    for (const title of ['a', 'b', 'c']) {
      await applyNodeOp(p, { type: 'rename', id, title }, io())
      seen.push(p.nodes[id].rev)
    }
    expect(seen).toEqual([...seen].sort((x, y) => x - y))
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('setExpanded does NOT bump rev — view state must never win a merge', async () => {
    const p = proj()
    const folder = Object.values(p.nodes).find((n) => n.type === 'folder')!.id
    const before = p.nodes[folder].rev
    await applyNodeOp(p, { type: 'setExpanded', id: folder, expanded: false }, io())
    expect(p.nodes[folder].expanded).toBe(false)
    expect(p.nodes[folder].rev).toBe(before)
  })
})

describe('structural ops', () => {
  it('create adds a node, writes its doc, and links it to the parent', async () => {
    const p = proj()
    const folder = Object.values(p.nodes).find((n) => n.type === 'folder')!.id
    const a = io()
    await applyNodeOp(p, { type: 'create', parentId: folder, nodeType: 'scene' }, a)
    const created = Object.values(p.nodes).find((n) => n.ext['_newId'])!
    expect(p.nodes[folder].childIds).toContain(created.id)
    expect(a.wrote).toContain(created.id)
    expect(created.rev).toBeGreaterThan(0)
  })

  it('_newId marks only the most recent create', async () => {
    const p = proj()
    const a = io()
    await applyNodeOp(p, { type: 'create', parentId: null, nodeType: 'folder', title: 'First' }, a)
    const first = Object.values(p.nodes).find((n) => n.ext['_newId'])!
    expect(first.title).toBe('First')

    await applyNodeOp(p, { type: 'create', parentId: null, nodeType: 'document', title: 'Second' }, a)
    const marked = Object.values(p.nodes).filter((n) => n.ext['_newId'])
    // Exactly one marker, and it is the node just created — callers use
    // `find(n => n.ext._newId)` to locate it, and `find` returns the first
    // match in insertion order, so a stale marker would win.
    expect(marked).toHaveLength(1)
    expect(marked[0].title).toBe('Second')
  })

  it('duplicate does not leave a stale _newId behind', async () => {
    const p = proj()
    const a = io()
    await applyNodeOp(p, { type: 'create', parentId: null, nodeType: 'document', title: 'Solo' }, a)
    await applyNodeOp(p, { type: 'create', parentId: null, nodeType: 'document', title: 'Latest' }, a)
    expect(Object.values(p.nodes).find((n) => n.ext['_newId'])!.title).toBe('Latest')
  })

  it('delete removes the subtree and its doc files', async () => {
    const p = proj()
    const folder = Object.values(p.nodes).find((n) => n.type === 'folder' && n.childIds.length > 0)!
    const doomed = [folder.id, ...folder.childIds]
    const a = io()
    await applyNodeOp(p, { type: 'delete', id: folder.id }, a)
    for (const id of doomed) expect(p.nodes[id]).toBeUndefined()
    expect(a.removed).toEqual(expect.arrayContaining(doomed))
  })

  it('move refuses to reparent a node into its own descendant', async () => {
    const p = proj()
    const folder = Object.values(p.nodes).find((n) => n.type === 'folder' && n.childIds.length > 0)!
    const child = folder.childIds[0]
    await applyNodeOp(p, { type: 'move', id: folder.id, newParentId: child, atIndex: 0 }, io())
    expect(p.nodes[folder.id].parentId).not.toBe(child)
  })
})

describe('outermost', () => {
  it('drops ids that already travel with a selected ancestor', () => {
    const p = proj()
    const folder = Object.values(p.nodes).find((n) => n.type === 'folder' && n.childIds.length > 0)!
    const child = folder.childIds[0]
    expect(outermost(p, [folder.id, child])).toEqual([folder.id])
  })

  it('keeps unrelated ids', () => {
    const p = proj()
    const folders = Object.values(p.nodes).filter((n) => n.type === 'folder').slice(0, 2)
    const ids = folders.map((f) => f.id)
    // Only keep the pair if neither contains the other.
    const kept = outermost(p, ids)
    expect(kept.length).toBeGreaterThanOrEqual(1)
    expect(kept.every((id) => ids.includes(id))).toBe(true)
  })

  it('preserves the caller-supplied order', () => {
    const p = proj()
    const docs = Object.values(p.nodes).filter((n) => n.type !== 'folder').slice(0, 3).map((n) => n.id)
    expect(outermost(p, docs)).toEqual(docs)
  })
})

describe('batch ops', () => {
  it('updateMetaMany patches every listed node in one pass', async () => {
    const p = proj()
    const ids = Object.values(p.nodes).filter((n) => n.type !== 'folder').slice(0, 3).map((n) => n.id)
    await applyNodeOp(p, { type: 'updateMetaMany', ids, patch: { status: 'revised' } }, io())
    for (const id of ids) expect(p.nodes[id].meta.status).toBe('revised')
  })

  it('updateMetaMany bumps rev on each node it touched', async () => {
    const p = proj()
    const ids = Object.values(p.nodes).filter((n) => n.type !== 'folder').slice(0, 2).map((n) => n.id)
    const before = ids.map((id) => p.nodes[id].rev)
    await applyNodeOp(p, { type: 'updateMetaMany', ids, patch: { label: 'note' } }, io())
    ids.forEach((id, i) => expect(p.nodes[id].rev).toBeGreaterThan(before[i]))
  })

  it('updateMetaMany leaves unlisted nodes alone', async () => {
    const p = proj()
    const all = Object.values(p.nodes).filter((n) => n.type !== 'folder').map((n) => n.id)
    const [target, ...rest] = all
    const untouched = rest.map((id) => p.nodes[id].meta.status)
    await applyNodeOp(p, { type: 'updateMetaMany', ids: [target], patch: { status: 'final' } }, io())
    rest.forEach((id, i) => expect(p.nodes[id].meta.status).toBe(untouched[i]))
  })

  it('trashMany moves every selected node to the Trash', async () => {
    const p = proj()
    const ids = Object.values(p.nodes)
      .filter((n) => n.type !== 'folder' && n.parentId !== p.trashId).slice(0, 2).map((n) => n.id)
    await applyNodeOp(p, { type: 'trashMany', ids }, io())
    for (const id of ids) expect(p.nodes[id].parentId).toBe(p.trashId)
  })

  it('trashMany does not move a child twice when its folder is also selected', async () => {
    const p = proj()
    const folder = Object.values(p.nodes).find((n) => n.type === 'folder' && n.childIds.length > 0)!
    const child = folder.childIds[0]
    await applyNodeOp(p, { type: 'trashMany', ids: [folder.id, child] }, io())
    // The folder goes to Trash and keeps its child; the child is NOT hoisted
    // out of it into the Trash as a sibling.
    expect(p.nodes[folder.id].parentId).toBe(p.trashId)
    expect(p.nodes[child].parentId).toBe(folder.id)
    expect(p.nodes[p.trashId!].childIds).not.toContain(child)
  })

  it('deleteMany removes every selected subtree and its doc files', async () => {
    const p = proj()
    const ids = Object.values(p.nodes).filter((n) => n.type !== 'folder').slice(0, 2).map((n) => n.id)
    const a = io()
    await applyNodeOp(p, { type: 'deleteMany', ids }, a)
    for (const id of ids) expect(p.nodes[id]).toBeUndefined()
    expect(a.removed).toEqual(expect.arrayContaining(ids))
  })

  it('deleteMany deletes a folder once, not once per selected descendant', async () => {
    const p = proj()
    const folder = Object.values(p.nodes).find((n) => n.type === 'folder' && n.childIds.length > 0)!
    const child = folder.childIds[0]
    const a = io()
    await applyNodeOp(p, { type: 'deleteMany', ids: [folder.id, child] }, a)
    expect(p.nodes[folder.id]).toBeUndefined()
    expect(p.nodes[child]).toBeUndefined()
    expect(a.removed.filter((id) => id === child)).toHaveLength(1)
  })

  it('an empty batch is a no-op', async () => {
    const p = proj()
    const before = JSON.stringify(p.nodes)
    await applyNodeOp(p, { type: 'updateMetaMany', ids: [], patch: { status: 'final' } }, io())
    await applyNodeOp(p, { type: 'trashMany', ids: [] }, io())
    expect(JSON.stringify(p.nodes)).toBe(before)
  })
})

describe('migrateProject', () => {
  it('backfills rev/modified on a v1 bundle and marks it v2', () => {
    const p = proj()
    // Simulate a bundle written before the schema bump.
    ;(p as { schemaVersion: number }).schemaVersion = 1
    for (const n of Object.values(p.nodes)) {
      delete (n as Partial<typeof n>).rev
      delete (n as Partial<typeof n>).modified
    }
    expect(migrateProject(p)).toBe(true)   // reports that it changed something
    expect(p.schemaVersion).toBe(2)
    for (const n of Object.values(p.nodes)) {
      expect(n.rev).toBe(1)
      expect(typeof n.modified).toBe('string')
    }
  })

  it('is idempotent and leaves an already-migrated bundle untouched', async () => {
    const p = proj()
    const id = firstDoc(p)
    await applyNodeOp(p, { type: 'rename', id, title: 'Kept' }, io())
    const rev = p.nodes[id].rev
    expect(migrateProject(p)).toBe(false)  // already current — no-op
    expect(migrateProject(p)).toBe(false)
    expect(p.nodes[id].rev).toBe(rev)
    expect(p.nodes[id].title).toBe('Kept')
  })
})
