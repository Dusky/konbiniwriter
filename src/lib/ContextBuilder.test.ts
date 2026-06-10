import { describe, it, expect } from 'vitest'
import { buildContext, estimateTokens } from './ContextBuilder'
import { buildIndex } from './MentionIndex'
import type { Project, KNode, DocMeta } from '@shared/types'

const baseMeta: DocMeta = {
  label: 'scene',
  status: 'draft',
  synopsis: '',
  target: 0,
  includeInCompile: true,
}

function makeNode(id: string, partial: Partial<KNode> = {}): KNode {
  return {
    id,
    type: 'document',
    title: id,
    parentId: null,
    childIds: [],
    expanded: true,
    meta: { ...baseMeta },
    ext: {},
    ...partial,
  }
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    schemaVersion: 1,
    id: 'proj1',
    title: 'Test Project',
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    rootIds: ['scene1'],
    trashId: null,
    nodes: { scene1: makeNode('scene1') },
    docs: { scene1: { content: '', snapshots: [] } },
    settings: { location: '/tmp' },
    ...overrides,
  }
}

describe('buildContext — tier inclusion order and budgets', () => {
  it('includes the scene content tier when it fits within budget', () => {
    const project = makeProject({ docs: { scene1: { content: 'Once upon a time.', snapshots: [] } } })
    const index = buildIndex(project.docs)
    const packet = buildContext(project, index, 'scene1', 'inline', 1000)
    const sceneTier = packet.tiers.find((t) => t.label === 'Scene content')
    expect(sceneTier?.included).toBe(true)
    expect(sceneTier?.truncated).toBeFalsy()
    expect(packet.truncated).toBe(false)
  })

  it('handles an exact-budget scene without truncation', () => {
    // Build content whose estimated token count exactly equals the budget.
    const budget = 50
    const content = 'x'.repeat(budget * 4)
    expect(estimateTokens(content)).toBe(budget)
    const project = makeProject({ docs: { scene1: { content, snapshots: [] } } })
    const index = buildIndex(project.docs)
    const packet = buildContext(project, index, 'scene1', 'inline', budget)
    const sceneTier = packet.tiers.find((t) => t.label === 'Scene content')
    expect(sceneTier?.included).toBe(true)
    expect(sceneTier?.truncated).toBeFalsy()
    expect(sceneTier?.content).toBe(content)
  })

  it('truncates an oversized scene, keeping the end and trimming to a paragraph break', () => {
    const budget = 1000 // plenty of room (>= MIN_TRUNCATE_TOKENS)
    const para1 = 'A'.repeat(2000)
    const para2 = 'B'.repeat(2000) // ~500 tokens, fits comfortably under budget
    const content = `${para1}\n\n${para2}`
    const project = makeProject({ docs: { scene1: { content, snapshots: [] } } })
    const index = buildIndex(project.docs)
    const packet = buildContext(project, index, 'scene1', 'inline', budget)
    const sceneTier = packet.tiers.find((t) => t.label === 'Scene content')
    expect(sceneTier?.included).toBe(true)
    expect(sceneTier?.truncated).toBe(true)
    expect(sceneTier?.content.startsWith('[…earlier scene content truncated…]')).toBe(true)
    // The retained tail should not include the start of the first paragraph.
    expect(sceneTier?.content).not.toContain('A'.repeat(2000))
    expect(packet.truncated).toBe(true)
  })

  it('drops the scene tier entirely when the remaining budget is too small to bother truncating', () => {
    const budget = 10 // well under MIN_TRUNCATE_TOKENS
    const content = 'word '.repeat(2000)
    const project = makeProject({ docs: { scene1: { content, snapshots: [] } } })
    const index = buildIndex(project.docs)
    const packet = buildContext(project, index, 'scene1', 'inline', budget)
    const sceneTier = packet.tiers.find((t) => t.label === 'Scene content')
    expect(sceneTier?.included).toBe(false)
    expect(packet.truncated).toBe(true)
  })

  it('includes synopsis and breadcrumb tiers for nested documents', () => {
    const project = makeProject({
      rootIds: ['ch1'],
      nodes: {
        ch1: makeNode('ch1', { type: 'folder', title: 'Chapter One', childIds: ['scene1'], meta: { ...baseMeta, synopsis: 'A chapter synopsis.' } }),
        scene1: makeNode('scene1', { parentId: 'ch1', title: 'Scene One' }),
      },
      docs: { scene1: { content: 'Some scene text.', snapshots: [] } },
    })
    const index = buildIndex(project.docs)
    const packet = buildContext(project, index, 'scene1', 'inline', 1000)
    const labels = packet.tiers.filter((t) => t.included).map((t) => t.label)
    expect(labels).toContain('Scene content')
    expect(labels).toContain('Chapter synopsis')
    expect(labels).toContain('Document path')
  })
})
