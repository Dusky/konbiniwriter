import { describe, it, expect } from 'vitest'
import { retrieve } from './RetrievalService'
import type { Project, KNode, DocBody, ID } from '@shared/types'

function doc(id: ID, title: string, content: string): [KNode, DocBody] {
  return [
    { id, type: 'document', title, parentId: null, childIds: [], expanded: false,
      meta: { label: 'none', status: 'todo', synopsis: '', target: 0, includeInCompile: true }, ext: {} },
    { content, snapshots: [] },
  ]
}

function makeProject(entries: Array<[KNode, DocBody]>): Project {
  const nodes: Record<ID, KNode> = {}
  const docs: Record<ID, DocBody> = {}
  for (const [node, body] of entries) { nodes[node.id] = node; docs[node.id] = body }
  return {
    schemaVersion: 1, id: `proj-${Math.random()}`, title: 'T', created: '', modified: '',
    rootIds: Object.keys(nodes), trashId: 'trash', nodes, docs, settings: { location: '' },
  } as Project
}

describe('retrieve (BM25)', () => {
  it('ranks the passage that matches the query terms first', () => {
    const project = makeProject([
      doc('a', 'Harbor', 'The lighthouse keeper polished the great lens every dawn over the harbor.'),
      doc('b', 'Market', 'The spice market smelled of cardamom and roasting chestnuts in winter.'),
      doc('c', 'Forest', 'Wolves moved through the pine forest under a cold indifferent moon.'),
    ])
    const hits = retrieve(project, 'lighthouse lens harbor keeper', { limit: 3 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].docId).toBe('a')
  })

  it('excludes the current document and returns [] for an empty query', () => {
    const project = makeProject([
      doc('a', 'One', 'cardamom cardamom cardamom market spice'),
      doc('b', 'Two', 'unrelated content about mountains'),
    ])
    expect(retrieve(project, 'cardamom market', { excludeDocId: 'a' }).every((p) => p.docId !== 'a')).toBe(true)
    expect(retrieve(project, '   ', {})).toEqual([])
  })
})
