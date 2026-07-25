import { describe, it, expect } from 'vitest'
import { applyNodeOp, migrateProject, nextRev, touchNode, type NodeOpIO } from './nodeOps'
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
