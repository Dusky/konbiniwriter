import { describe, it, expect } from 'vitest'
import {
  matchesQuery, runQuery, isEmptyQuery, normalizeKeywords, allKeywords, keywordCounts,
} from './query'
import { buildProjectFromTemplate } from './templates'
import type { Project, ID } from './types'

// A small hand-built project: two chapters, four scenes, plus the Trash folder
// the template always creates.
function fixture(): { project: Project; ids: Record<string, ID> } {
  const project = buildProjectFromTemplate('T', 'blank', '/tmp')
  const ids: Record<string, ID> = {}
  project.rootIds = project.rootIds.filter((id) => id === project.trashId)
  for (const id of Object.keys(project.nodes)) {
    if (id !== project.trashId) delete project.nodes[id]
  }
  project.docs = {}

  const add = (
    key: string, type: 'folder' | 'scene', title: string, parentId: ID | null,
    meta: Partial<Project['nodes'][string]['meta']> = {}, body = '',
  ) => {
    const id = key
    ids[key] = id
    project.nodes[id] = {
      id, type, title, parentId, childIds: [], expanded: true, rev: 1,
      modified: '2026-01-01T00:00:00.000Z', ext: {},
      meta: { label: 'none', status: 'todo', synopsis: '', target: 0, includeInCompile: true, ...meta },
    }
    if (parentId) project.nodes[parentId].childIds.push(id)
    // New roots go in before Trash, in the order they're added.
    else project.rootIds.splice(project.rootIds.indexOf(project.trashId!), 0, id)
    if (type !== 'folder') project.docs[id] = { content: body, snapshots: [] }
    return id
  }

  add('ch1', 'folder', 'Chapter One', null, { keywords: ['act-1'] })
  add('s1', 'scene', 'The arrival', ids.ch1,
    { status: 'draft', label: 'scene', keywords: ['Mira', 'pov-alex'], synopsis: 'She arrives late.' },
    'Mira stepped off the train. ' + 'word '.repeat(100))
  add('s2', 'scene', 'The market', ids.ch1,
    { status: 'final', label: 'scene', keywords: ['mira', 'pov-bea'] },
    'A short one.')
  add('ch2', 'folder', 'Chapter Two', null)
  add('s3', 'scene', 'The letter', ids.ch2,
    { status: 'draft', label: 'note', keywords: ['pov-alex'], includeInCompile: false },
    'word '.repeat(2000))
  add('s4', 'scene', 'Untagged', ids.ch2, {}, 'nothing special')

  // A trashed scene, to prove filters ignore the Trash subtree.
  add('trashed', 'scene', 'Deleted draft', project.trashId, { keywords: ['mira'] }, 'Mira again')

  return { project, ids }
}

describe('matchesQuery', () => {
  const { project } = fixture()

  it('matches everything when the query is empty', () => {
    for (const id of ['ch1', 's1', 's4']) expect(matchesQuery(project, id, {})).toBe(true)
  })

  it('matches keywords case-insensitively', () => {
    expect(matchesQuery(project, 's1', { keywords: ['mira'] })).toBe(true)
    expect(matchesQuery(project, 's2', { keywords: ['MIRA'] })).toBe(true)
  })

  it('requires ALL keywords, not any', () => {
    expect(matchesQuery(project, 's1', { keywords: ['mira', 'pov-alex'] })).toBe(true)
    expect(matchesQuery(project, 's2', { keywords: ['mira', 'pov-alex'] })).toBe(false)
  })

  it('treats labels and statuses as any-of', () => {
    expect(matchesQuery(project, 's1', { statuses: ['draft', 'final'] })).toBe(true)
    expect(matchesQuery(project, 's2', { statuses: ['draft', 'final'] })).toBe(true)
    expect(matchesQuery(project, 's4', { statuses: ['draft', 'final'] })).toBe(false)
    expect(matchesQuery(project, 's3', { labels: ['note'] })).toBe(true)
    expect(matchesQuery(project, 's1', { labels: ['note'] })).toBe(false)
  })

  it('filters on the compile flag', () => {
    expect(matchesQuery(project, 's3', { includeInCompile: false })).toBe(true)
    expect(matchesQuery(project, 's1', { includeInCompile: false })).toBe(false)
  })

  it('searches title, synopsis and body', () => {
    expect(matchesQuery(project, 's1', { text: 'arrival' })).toBe(true)      // title
    expect(matchesQuery(project, 's1', { text: 'arrives late' })).toBe(true) // synopsis
    expect(matchesQuery(project, 's1', { text: 'off the train' })).toBe(true)// body
    expect(matchesQuery(project, 's1', { text: 'nowhere' })).toBe(false)
  })

  it('applies word bounds to documents', () => {
    expect(matchesQuery(project, 's2', { maxWords: 10 })).toBe(true)
    expect(matchesQuery(project, 's2', { minWords: 100 })).toBe(false)
    expect(matchesQuery(project, 's3', { minWords: 1000 })).toBe(true)
  })

  it('excludes folders from a word-bounded query rather than counting them as zero', () => {
    expect(matchesQuery(project, 'ch1', { maxWords: 10 })).toBe(false)
    expect(matchesQuery(project, 'ch1', {})).toBe(true)
  })

  it('combines filters as AND', () => {
    expect(matchesQuery(project, 's1', { keywords: ['mira'], statuses: ['draft'] })).toBe(true)
    expect(matchesQuery(project, 's2', { keywords: ['mira'], statuses: ['draft'] })).toBe(false)
  })

  it('returns false for an unknown node instead of throwing', () => {
    expect(matchesQuery(project, 'nope', {})).toBe(false)
  })
})

describe('runQuery', () => {
  const { project } = fixture()

  it('returns matches in binder order, not insertion order', () => {
    expect(runQuery(project, { keywords: ['pov-alex'] })).toEqual(['s1', 's3'])
  })

  it('never returns anything from the Trash', () => {
    const hits = runQuery(project, { keywords: ['mira'] })
    expect(hits).toEqual(['s1', 's2'])
    expect(hits).not.toContain('trashed')
  })

  it('returns every live node for an empty query', () => {
    expect(runQuery(project, {})).toEqual(['ch1', 's1', 's2', 'ch2', 's3', 's4'])
  })
})

describe('isEmptyQuery', () => {
  it('is true for {} and for empty filter arrays', () => {
    expect(isEmptyQuery({})).toBe(true)
    expect(isEmptyQuery({ keywords: [], labels: [], text: '  ' })).toBe(true)
  })

  it('is false once any filter is set — including a zero word bound', () => {
    expect(isEmptyQuery({ keywords: ['a'] })).toBe(false)
    expect(isEmptyQuery({ minWords: 0 })).toBe(false)
    expect(isEmptyQuery({ includeInCompile: false })).toBe(false)
  })
})

describe('normalizeKeywords', () => {
  it('trims, drops empties, and de-duplicates case-insensitively', () => {
    expect(normalizeKeywords([' Mira ', 'mira', '', '  ', 'POV-Alex']))
      .toEqual(['Mira', 'POV-Alex'])
  })

  it('keeps the first spelling the writer used', () => {
    expect(normalizeKeywords(['MIRA', 'mira'])).toEqual(['MIRA'])
  })
})

describe('allKeywords / keywordCounts', () => {
  const { project } = fixture()

  it('lists every keyword in use, once, sorted', () => {
    expect(allKeywords(project)).toEqual(['act-1', 'Mira', 'pov-alex', 'pov-bea'])
  })

  it('counts nodes per keyword, folding case', () => {
    const counts = keywordCounts(project)
    expect(counts.get('mira')).toBe(3)   // s1, s2, and the trashed scene
    expect(counts.get('pov-alex')).toBe(2)
    expect(counts.get('act-1')).toBe(1)
  })
})
