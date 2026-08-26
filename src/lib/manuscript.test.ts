import { describe, it, expect } from 'vitest'
import { manuscriptDocs, manuscriptRoot, ambiguousTitles } from './manuscript'
import type { Project } from '@shared/types'

function novel(): Project {
  const node = (id: string, type: 'folder' | 'scene' | 'document', title: string, parentId: string | null, childIds: string[] = []) => ({
    id, type, title, parentId, childIds, expanded: true,
    meta: { label: 'none' as const, status: 'draft' as const, synopsis: '', target: 0, includeInCompile: type !== 'folder', keywords: [] },
    ext: {}, rev: 1, modified: '',
  })
  const nodes: Record<string, ReturnType<typeof node>> = {}
  const add = (n: ReturnType<typeof node>) => { nodes[n.id] = n }
  add(node('trash', 'folder', 'Trash', null, ['binned']))
  add(node('binned', 'scene', 'Cut scene', 'trash'))
  add(node('ms', 'folder', 'Manuscript', null, ['ch1', 'ch2']))
  add(node('ch1', 'folder', 'Chapter 1', 'ms', ['s1', 's2']))
  add(node('s1', 'scene', 'The first customer', 'ch1'))
  add(node('s2', 'scene', 'The Woman in White', 'ch1'))
  add(node('ch2', 'folder', 'Chapter 2', 'ms', ['s3']))
  add(node('s3', 'scene', 'Nori-san', 'ch2'))
  add(node('chars', 'folder', 'Characters', null, ['c1']))
  add(node('c1', 'document', 'The Woman in White', 'chars'))
  add(node('res', 'folder', 'Research', null, ['r1']))
  add(node('r1', 'document', 'Folklore notes', 'res'))
  return {
    schemaVersion: 2, id: 'p', title: 'Midnight Aisle', created: '', modified: '',
    rootIds: ['ms', 'chars', 'res', 'trash'], trashId: 'trash',
    nodes: nodes as unknown as Project['nodes'],
    docs: { s1: { content: 'a', snapshots: [] }, s2: { content: 'b', snapshots: [] }, s3: { content: '', snapshots: [] }, c1: { content: 'c', snapshots: [] }, r1: { content: 'd', snapshots: [] }, binned: { content: 'e', snapshots: [] } },
    settings: { location: '', template: 'novel' },
  } as unknown as Project
}

describe('manuscriptRoot', () => {
  it('is the first root folder that is not the trash', () => {
    expect(manuscriptRoot(novel())).toBe('ms')
  })

  it('skips the trash even when it sorts first', () => {
    const p = novel()
    p.rootIds = ['trash', 'ms', 'chars']
    expect(manuscriptRoot(p)).toBe('ms')
  })

  it('is null when there is nothing to compile', () => {
    const p = novel()
    p.rootIds = ['trash']
    expect(manuscriptRoot(p)).toBeNull()
  })
})

describe('manuscriptDocs', () => {
  it('returns the manuscript in binder order', () => {
    expect(manuscriptDocs(novel()).map((d) => d.id)).toEqual(['s1', 's2', 's3'])
  })

  it('leaves out character sheets and research notes', () => {
    // Judging a character sheet for prose quality is meaningless, and it costs
    // a model call to find that out.
    const ids = manuscriptDocs(novel()).map((d) => d.id)
    expect(ids).not.toContain('c1')
    expect(ids).not.toContain('r1')
  })

  it('leaves out the trash — a scene you deleted is not part of your book', () => {
    expect(manuscriptDocs(novel()).map((d) => d.id)).not.toContain('binned')
  })

  it('honours includeInCompile', () => {
    const p = novel()
    p.nodes.s2.meta.includeInCompile = false
    expect(manuscriptDocs(p).map((d) => d.id)).toEqual(['s1', 's3'])
  })

  it('names the folder each document sits in', () => {
    expect(manuscriptDocs(novel()).find((d) => d.id === 's3')!.parentTitle).toBe('Chapter 2')
  })

  it('has nothing to say about a project with no manuscript', () => {
    const p = novel()
    p.rootIds = ['trash']
    expect(manuscriptDocs(p)).toEqual([])
  })
})

describe('ambiguousTitles', () => {
  it('finds titles that appear more than once', () => {
    const docs = [
      { id: 'a', title: 'The Woman in White', parentTitle: 'Chapter 1', content: '' },
      { id: 'b', title: 'The Woman in White', parentTitle: 'Characters', content: '' },
      { id: 'c', title: 'Nori-san', parentTitle: 'Chapter 2', content: '' },
    ]
    expect([...ambiguousTitles(docs)]).toEqual(['The Woman in White'])
  })

  it('is empty when every title is distinct', () => {
    expect(ambiguousTitles(manuscriptDocs(novel())).size).toBe(0)
  })
})
