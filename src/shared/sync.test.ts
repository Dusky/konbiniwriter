import { describe, it, expect } from 'vitest'
import {
  hashContent, reconcileDoc, mergeNodes, planMerge, emptySyncLog, syncLogFor,
  makeDeviceId, conflictFileName,
} from './sync'
import { buildProjectFromTemplate } from './templates'
import { applyNodeOp } from './nodeOps'
import type { Project, KNode, ID } from './types'

const proj = (): Project => buildProjectFromTemplate('T', 'novel', '/tmp')
const io = { writeDoc: async () => {}, removeDoc: async () => {} }
const firstDoc = (p: Project): ID => Object.values(p.nodes).find((n) => n.type !== 'folder')!.id
const node = (id: ID, rev: number, title = id, modified = '2024-01-01T00:00:00.000Z'): KNode => ({
  id, type: 'document', title, parentId: null, childIds: [], expanded: false,
  meta: { label: 'none', status: 'todo', synopsis: '', target: 0, includeInCompile: true },
  ext: {}, rev, modified,
})

describe('hashContent', () => {
  it('is stable, and differs for different content', () => {
    expect(hashContent('abc')).toBe(hashContent('abc'))
    expect(hashContent('abc')).not.toBe(hashContent('abd'))
    expect(hashContent('')).toHaveLength(8)
  })
})

describe('device identity', () => {
  it('mints distinct ids', () => {
    expect(makeDeviceId()).not.toBe(makeDeviceId())
    expect(emptySyncLog('dev-x').deviceId).toBe('dev-x')
  })
})

describe('reconcileDoc', () => {
  const base = hashContent('base')

  it('identical sides are unchanged', () => {
    expect(reconcileDoc('same', 'same', base).kind).toBe('unchanged')
  })

  it('fast-forwards when only the remote moved', () => {
    const r = reconcileDoc('base', 'theirs', base)
    expect(r).toEqual({ kind: 'fast-forward', content: 'theirs', from: 'remote' })
  })

  it('keeps local when only local moved', () => {
    const r = reconcileDoc('mine', 'base', base)
    expect(r).toEqual({ kind: 'fast-forward', content: 'mine', from: 'local' })
  })

  it('conflicts when both moved — and preserves the remote rather than dropping it', () => {
    const r = reconcileDoc('mine', 'theirs', base)
    expect(r.kind).toBe('conflict')
    if (r.kind === 'conflict') {
      expect(r.content).toBe('mine')
      expect(r.preserve).toBe('theirs')
    }
  })

  it('without a known ancestor it refuses to guess and conflicts', () => {
    const r = reconcileDoc('mine', 'theirs', undefined)
    expect(r.kind).toBe('conflict')
  })
})

describe('mergeNodes', () => {
  it('higher rev wins', () => {
    const local = { nodes: { a: node('a', 3, 'local') }, rootIds: ['a'] }
    const remote = { nodes: { a: node('a', 7, 'remote') }, rootIds: ['a'] }
    const m = mergeNodes(local, remote, 3)
    expect(m.nodes.a.title).toBe('remote')
    expect(m.tookRemote).toContain('a')
  })

  it('local wins when it has the higher rev', () => {
    const local = { nodes: { a: node('a', 9, 'local') }, rootIds: ['a'] }
    const remote = { nodes: { a: node('a', 2, 'remote') }, rootIds: ['a'] }
    expect(mergeNodes(local, remote, 2).nodes.a.title).toBe('local')
  })

  it('breaks an equal-rev tie with modified time', () => {
    const local = { nodes: { a: node('a', 5, 'local', '2024-01-01T00:00:00.000Z') }, rootIds: ['a'] }
    const remote = { nodes: { a: node('a', 5, 'remote', '2024-06-01T00:00:00.000Z') }, rootIds: ['a'] }
    expect(mergeNodes(local, remote, 5).nodes.a.title).toBe('remote')
  })

  it('adopts nodes only the remote has', () => {
    const local = { nodes: { a: node('a', 1) }, rootIds: ['a'] }
    const remote = { nodes: { a: node('a', 1), b: node('b', 2) }, rootIds: ['a', 'b'] }
    const m = mergeNodes(local, remote, 1)
    expect(m.nodes.b).toBeDefined()
    expect(m.rootIds).toEqual(['a', 'b'])
  })

  it('accepts a remote delete for a node untouched locally', () => {
    const local = { nodes: { a: node('a', 1), gone: node('gone', 1) }, rootIds: ['a', 'gone'] }
    const remote = { nodes: { a: node('a', 1) }, rootIds: ['a'] }
    const m = mergeNodes(local, remote, 1)
    expect(m.nodes.gone).toBeUndefined()
    expect(m.deleted).toContain('gone')
    expect(m.rootIds).toEqual(['a'])
  })

  it('REFUSES a remote delete when the node was edited locally since the last sync', () => {
    // The critical safety case: never lose new work to a stale delete.
    const local = { nodes: { a: node('a', 1), fresh: node('fresh', 9, 'my new scene') }, rootIds: ['a', 'fresh'] }
    const remote = { nodes: { a: node('a', 1) }, rootIds: ['a'] }
    const m = mergeNodes(local, remote, 1)
    expect(m.nodes.fresh).toBeDefined()
    expect(m.nodes.fresh.title).toBe('my new scene')
    expect(m.deleted).not.toContain('fresh')
  })

  it('prunes child references to nodes that did not survive', () => {
    const parent = { ...node('p', 1), type: 'folder' as const, childIds: ['kid', 'gone'] }
    const local = { nodes: { p: parent, kid: node('kid', 1), gone: node('gone', 1) }, rootIds: ['p'] }
    const remote = { nodes: { p: { ...parent, childIds: ['kid'] }, kid: node('kid', 1) }, rootIds: ['p'] }
    const m = mergeNodes(local, remote, 1)
    expect(m.nodes.p.childIds).toEqual(['kid'])
  })

  it('does not mutate the caller\'s nodes while pruning', () => {
    // The winning node objects are the caller's own; pruning must clone them.
    const parent = { ...node('p', 1), type: 'folder' as const, childIds: ['kid', 'gone'] }
    const local = { nodes: { p: parent, kid: node('kid', 1), gone: node('gone', 1) }, rootIds: ['p'] }
    const remote = { nodes: { p: { ...parent, childIds: ['kid'] }, kid: node('kid', 1) }, rootIds: ['p'] }
    mergeNodes(local, remote, 1)
    expect(local.nodes.p.childIds).toEqual(['kid', 'gone'])   // untouched
  })
})

describe('planMerge', () => {
  it('reports no conflicts when the remote is identical', () => {
    const p = proj()
    const log = syncLogFor(p, 'dev-1')
    const plan = planMerge(p, { nodes: p.nodes, rootIds: p.rootIds, docs: p.docs }, log)
    expect(plan.hasConflicts).toBe(false)
    expect(plan.docs.every((d) => d.outcome.kind === 'unchanged')).toBe(true)
  })

  it('flags a true two-sided divergence on one document', () => {
    const p = proj()
    const id = firstDoc(p)
    p.docs[id].content = 'ancestor'
    const log = syncLogFor(p, 'dev-1')          // ancestor recorded here
    p.docs[id].content = 'my version'            // local moves
    const remoteDocs = { ...p.docs, [id]: { content: 'their version' } }
    const plan = planMerge(p, { nodes: p.nodes, rootIds: p.rootIds, docs: remoteDocs }, log)
    expect(plan.hasConflicts).toBe(true)
    const hit = plan.docs.find((d) => d.docId === id)!
    expect(hit.outcome.kind).toBe('conflict')
  })

  it('fast-forwards a document only the remote changed', () => {
    const p = proj()
    const id = firstDoc(p)
    p.docs[id].content = 'ancestor'
    const log = syncLogFor(p, 'dev-1')
    const remoteDocs = { ...p.docs, [id]: { content: 'their edit' } }
    const plan = planMerge(p, { nodes: p.nodes, rootIds: p.rootIds, docs: remoteDocs }, log)
    expect(plan.hasConflicts).toBe(false)
    const hit = plan.docs.find((d) => d.docId === id)!
    expect(hit.outcome).toMatchObject({ kind: 'fast-forward', from: 'remote', content: 'their edit' })
  })

  it('a real local edit after the last sync survives a remote that deleted the node', async () => {
    const p = proj()
    const id = firstDoc(p)
    const log = syncLogFor(p, 'dev-1')
    await applyNodeOp(p, { type: 'rename', id, title: 'Kept locally' }, io)   // bumps rev past baseRev
    const remoteNodes = { ...p.nodes }
    delete remoteNodes[id]
    const plan = planMerge(p, { nodes: remoteNodes, rootIds: p.rootIds.filter((r) => r !== id), docs: p.docs }, log)
    expect(plan.nodes.nodes[id]).toBeDefined()
    expect(plan.nodes.nodes[id].title).toBe('Kept locally')
  })

  it('is side-effect free — the local project is not mutated', () => {
    const p = proj()
    const id = firstDoc(p)
    p.docs[id].content = 'original'
    const log = syncLogFor(p, 'dev-1')
    const before = JSON.stringify(p)
    planMerge(p, { nodes: p.nodes, rootIds: p.rootIds, docs: { ...p.docs, [id]: { content: 'other' } } }, log)
    expect(JSON.stringify(p)).toBe(before)
  })
})

describe('conflictFileName', () => {
  it('matches the existing .conflict-<stamp>.md convention', () => {
    const name = conflictFileName('s1', new Date('2024-03-04T05:06:07.008Z'))
    expect(name).toBe('s1.conflict-2024-03-04T05-06-07-008Z.md')
  })
})
