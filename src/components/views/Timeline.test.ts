// The story map's grouping.
//
// This view used to make one lane per *top-level* folder and flatten every
// descendant into it, so a three-chapter manuscript arrived as one undivided
// row of cards and Trash got a lane of its own. `buildRows` is exported so the
// shape can be checked without a browser.

import { describe, it, expect } from 'vitest'
import { buildRows } from './Timeline'
import type { ID, Project } from '@shared/types'

function project(): Project {
  const node = (id: string, type: 'folder' | 'scene' | 'document', title: string, parentId: string | null, childIds: ID[] = []) => ({
    id, type, title, parentId, childIds, expanded: true,
    meta: { label: 'none' as const, status: 'draft' as const, synopsis: '', target: 0, includeInCompile: type !== 'folder', keywords: [] },
    ext: {}, rev: 1, modified: '',
  })
  const nodes: Record<string, ReturnType<typeof node>> = {}
  const add = (n: ReturnType<typeof node>) => { nodes[n.id] = n }
  add(node('trash', 'folder', 'Trash', null, ['binned']))
  add(node('binned', 'scene', 'Deleted scene', 'trash'))
  add(node('ms', 'folder', 'Manuscript', null, ['p1', 'p2']))
  add(node('p1', 'folder', 'Part One', 'ms', ['ch1', 'ch2']))
  add(node('ch1', 'folder', 'Chapter 1', 'p1', ['s1', 's2']))
  add(node('s1', 'scene', 'The first customer', 'ch1'))
  add(node('s2', 'scene', 'Aisle Nine', 'ch1'))
  add(node('ch2', 'folder', 'Chapter 2', 'p1', ['s3']))
  add(node('s3', 'scene', 'The Woman in White', 'ch2'))
  add(node('p2', 'folder', 'Part Two', 'ms', ['ch3']))
  add(node('ch3', 'folder', 'Chapter 3', 'p2', []))
  add(node('chars', 'folder', 'Characters', null, ['c1']))
  add(node('c1', 'document', 'Reiko Tanaka', 'chars'))
  return {
    schemaVersion: 2, id: 'p', title: 'Midnight Aisle', created: '', modified: '',
    rootIds: ['ms', 'chars', 'trash'], trashId: 'trash',
    nodes: nodes as unknown as Project['nodes'], docs: {},
    settings: { location: '', template: 'novel' },
  } as unknown as Project
}

describe('buildRows', () => {
  it('gives each chapter its own lane, not one lane for the whole manuscript', () => {
    expect(buildRows(project()).map((r) => r.folderTitle))
      .toEqual(['Chapter 1', 'Chapter 2', 'Characters'])
  })

  it('puts the right cards in each lane, in binder order', () => {
    const rows = buildRows(project())
    expect(rows.find((r) => r.folderTitle === 'Chapter 1')!.sceneIds).toEqual(['s1', 's2'])
    expect(rows.find((r) => r.folderTitle === 'Chapter 2')!.sceneIds).toEqual(['s3'])
  })

  it('never gives Trash a lane', () => {
    const rows = buildRows(project())
    expect(rows.map((r) => r.folderTitle)).not.toContain('Trash')
    expect(rows.flatMap((r) => r.sceneIds)).not.toContain('binned')
  })

  it('skips folders that only hold other folders', () => {
    // "Part One" contributes nothing itself; its chapters are the lanes.
    expect(buildRows(project()).map((r) => r.folderTitle)).not.toContain('Part One')
    expect(buildRows(project()).map((r) => r.folderTitle)).not.toContain('Manuscript')
  })

  it('skips a chapter with nothing in it yet', () => {
    expect(buildRows(project()).map((r) => r.folderTitle)).not.toContain('Chapter 3')
  })

  it('carries the path above each lane, so two Chapter 1s are tellable apart', () => {
    const rows = buildRows(project())
    expect(rows.find((r) => r.folderTitle === 'Chapter 1')!.folderPath).toBe('Manuscript › Part One')
  })

  it('collects loose top-level documents into one lane', () => {
    const p = project()
    p.nodes.loose = { ...p.nodes.c1, id: 'loose', title: 'Stray note', parentId: null }
    p.rootIds = ['loose', ...p.rootIds]
    const rows = buildRows(p)
    expect(rows[0]!.folderTitle).toBe('Ungrouped')
    expect(rows[0]!.sceneIds).toEqual(['loose'])
  })

  it('has nothing to show for an empty project', () => {
    const p = project()
    p.rootIds = ['trash']
    expect(buildRows(p)).toEqual([])
  })
})
