// projectStore is the seam every other test takes for granted: the one place
// document content changes, the queue that feeds changeset review, and the
// selection semantics every node action reads through. It has been driven hard
// by the smoke test and never tested as a unit.

import { describe, it, expect, beforeEach } from 'vitest'
import { useProjectStore, subtreeWordCount, descendants, isDescendant, flattenVisible } from './projectStore'
import { backlinksFor } from '../lib/MentionIndex'
import type { KNode, Project, Proposal } from '@shared/types'

const node = (id: string, title: string, patch: Partial<KNode> = {}): KNode => ({
  id, type: 'scene', title, parentId: null, childIds: [], expanded: true,
  meta: { label: 'scene', status: 'draft', synopsis: '', target: 0, includeInCompile: true, keywords: [] },
  ext: {}, rev: 1, modified: '', ...patch,
})

/** ch1 › [a, b]; ch2 › [c]; plus trash. */
function fixture(): Project {
  return {
    schemaVersion: 2, id: 'p', title: 'Book', created: '', modified: '',
    rootIds: ['ch1', 'ch2', 'trash'], trashId: 'trash',
    nodes: {
      ch1: node('ch1', 'Chapter One', { type: 'folder', childIds: ['a', 'b'] }),
      ch2: node('ch2', 'Chapter Two', { type: 'folder', childIds: ['c'] }),
      trash: node('trash', 'Trash', { type: 'folder' }),
      a: node('a', 'A', { parentId: 'ch1' }),
      b: node('b', 'B', { parentId: 'ch1' }),
      c: node('c', 'C', { parentId: 'ch2' }),
    },
    docs: {
      a: { content: 'one two three', snapshots: [] },
      b: { content: 'four five', snapshots: [] },
      c: { content: '[[Mira]] waited', snapshots: [] },
    },
    settings: { location: '', codex: [], comments: [] },
  } as Project
}

const store = () => useProjectStore.getState()
const proposal = (id: string, docId = 'a'): Proposal => ({
  id, docId, docTitle: 'A', command: 'revision', label: id, group: 'test',
  original: 'x', proposed: 'y', createdAt: '', accepted: [], nHunks: 1,
  status: 'pending', seq: 0, promptId: '', model: '', temperature: 0,
  contextFingerprint: '', costCents: 0,
} as unknown as Proposal)

beforeEach(() => { store().loadProject(fixture()) })

describe('tree utilities', () => {
  it('sums a subtree, folders included', () => {
    expect(subtreeWordCount(store().project!, 'ch1')).toBe(5)
    expect(subtreeWordCount(store().project!, 'a')).toBe(3)
  })
  it('returns 0 for a node that is gone', () => {
    expect(subtreeWordCount(store().project!, 'ghost')).toBe(0)
  })
  it('lists descendants depth-first', () => {
    expect(descendants(store().project!, 'ch1')).toEqual(['a', 'b'])
    expect(descendants(store().project!, 'a')).toEqual([])
  })
  it('knows ancestry, and that a node is not its own descendant', () => {
    expect(isDescendant(store().project!, 'ch1', 'a')).toBe(true)
    expect(isDescendant(store().project!, 'ch1', 'c')).toBe(false)
    expect(isDescendant(store().project!, 'ch1', 'ch1')).toBe(false)
  })
  it('hides the children of a collapsed folder from the visible list', () => {
    const p = fixture()
    p.nodes.ch1!.expanded = false
    store().loadProject(p)
    expect(flattenVisible(store().project!).map((r) => r.id)).toEqual(['ch1', 'ch2', 'c', 'trash'])
  })
})

describe('updateContent — the one mutation seam', () => {
  it('writes the content into the store', () => {
    store().updateContent('a', 'rewritten')
    expect(store().project!.docs.a!.content).toBe('rewritten')
  })

  it('marks the project unsaved, so the status bar tells the truth', () => {
    store().updateContent('a', 'rewritten')
    expect(store().saveStatus).toBe('saving')
  })

  it('counts added words into the session tally, and never below zero', () => {
    store().updateContent('a', 'one two three four five')
    expect(store().sessionWordsAdded).toBe(2)
    store().updateContent('a', 'one')
    expect(store().sessionWordsAdded).toBe(0)
  })

  it('refreshes the mention index, so backlinks self-heal', () => {
    expect(backlinksFor(store().mentionIndex, 'Mira')).toEqual(['c'])
    store().updateContent('a', 'now [[Mira]] is here too')
    expect(backlinksFor(store().mentionIndex, 'Mira').sort()).toEqual(['a', 'c'])
    store().updateContent('c', 'she left')
    expect(backlinksFor(store().mentionIndex, 'Mira')).toEqual(['a'])
  })

  it('ignores a write with no project loaded rather than throwing', () => {
    store().unloadProject()
    expect(() => store().updateContent('a', 'x')).not.toThrow()
  })
})

describe('selection', () => {
  it('a plain click collapses the selection to one node', () => {
    store().selectNode('a')
    store().toggleSelect('b')
    expect(store().selectedIds).toEqual(['a', 'b'])
    store().selectNode('c')
    expect(store().selectedIds).toEqual(['c'])
  })

  it('keeps the selection in binder order however you build it', () => {
    store().selectNode('b')
    store().toggleSelect('a')
    expect(store().selectedIds).toEqual(['a', 'b'])
  })

  it('deselecting the active node hands active to what is left', () => {
    store().selectNode('a')
    store().toggleSelect('b')
    store().toggleSelect('a')
    expect(store().selectedIds).toEqual(['b'])
    expect(store().selectedId).toBe('b')
  })

  it('shift-click sweeps the visible range', () => {
    store().selectNode('a')
    store().selectRange('c')
    expect(store().selectedIds).toContain('a')
    expect(store().selectedIds).toContain('c')
  })

  it('actionTargets is the whole selection, or just what you clicked', () => {
    store().selectNode('a')
    store().toggleSelect('b')
    expect(store().actionTargets('a')).toEqual(['a', 'b'])
    // Right-clicking outside the selection acts on that node alone.
    expect(store().actionTargets('c')).toEqual(['c'])
    store().selectNode('a')
    expect(store().actionTargets('a')).toEqual(['a'])
  })

  it('opens a document as a tab, but never a folder', () => {
    store().selectNode('a')
    expect(store().openTabs).toEqual(['a'])
    store().selectNode('ch1')
    expect(store().openTabs).toEqual(['a'])
  })

  it('does not open the same document twice', () => {
    store().selectNode('a')
    store().selectNode('b')
    store().selectNode('a')
    expect(store().openTabs).toEqual(['a', 'b'])
  })

  it('selecting a document leaves whatever view tab was open', () => {
    store().openViewTab('stats')
    expect(store().activeViewTab).toBe('stats')
    store().selectNode('a')
    expect(store().activeViewTab).toBeNull()
  })

  it('closing the active tab activates a neighbour rather than nothing', () => {
    store().selectNode('a')
    store().selectNode('b')
    store().closeTab('b')
    expect(store().openTabs).toEqual(['a'])
    expect(store().selectedId).toBe('a')
  })
})

describe('proposal queue', () => {
  it('the first queued proposal becomes active', () => {
    store().queueProposal(proposal('p1'))
    expect(store().activeProposalId).toBe('p1')
  })

  it('a second one waits its turn instead of stealing the review', () => {
    store().queueProposal(proposal('p1'))
    store().queueProposal(proposal('p2'))
    expect(store().activeProposalId).toBe('p1')
  })

  it('resolving advances to the next pending one — the multi-doc flow', () => {
    store().queueProposal(proposal('p1'))
    store().queueProposal(proposal('p2'))
    store().resolveProposal('p1', 'applied')
    expect(store().activeProposalId).toBe('p2')
    expect(store().proposals.find((p) => p.id === 'p1')?.status).toBe('applied')
  })

  it('closes the review when the last one is resolved', () => {
    store().queueProposal(proposal('p1'))
    store().resolveProposal('p1', 'discarded')
    expect(store().activeProposalId).toBeNull()
  })

  it('never re-activates something already resolved', () => {
    store().queueProposal(proposal('p1'))
    store().queueProposal(proposal('p2'))
    store().resolveProposal('p2', 'discarded')
    store().resolveProposal('p1', 'applied')
    expect(store().activeProposalId).toBeNull()
  })

  it('loading a project clears any queue left from the last one', () => {
    store().queueProposal(proposal('p1'))
    store().loadProject(fixture())
    expect(store().proposals).toEqual([])
    expect(store().activeProposalId).toBeNull()
  })
})

describe('structural undo/redo', () => {
  const withoutB = () => {
    const p = store().project!
    const nodes = { ...p.nodes }
    delete nodes.b
    return { rootIds: p.rootIds, nodes: { ...nodes, ch1: { ...nodes.ch1!, childIds: ['a'] } }, docs: p.docs }
  }

  it('undo puts a deleted node back', () => {
    store().applyMutation(withoutB())
    expect(store().project!.nodes.b).toBeUndefined()
    expect(store().undoMutation()).toBe(true)
    expect(store().project!.nodes.b).toBeDefined()
  })

  it('redo takes it away again', () => {
    store().applyMutation(withoutB())
    store().undoMutation()
    expect(store().redoMutation()).toBe(true)
    expect(store().project!.nodes.b).toBeUndefined()
  })

  it('reports false when there is nothing to undo, rather than throwing', () => {
    expect(store().undoMutation()).toBe(false)
    expect(store().redoMutation()).toBe(false)
  })

  it('a fresh mutation drops the redo future', () => {
    store().applyMutation(withoutB())
    store().undoMutation()
    store().applyMutation(withoutB())
    expect(store().redoMutation()).toBe(false)
  })
})

describe('snapshots', () => {
  const snap = (id: string, content = 'old') =>
    ({ id, title: '', takenAt: new Date().toISOString(), content, words: 1, kind: 'auto' as const })

  it('newest first, so History reads top-down', () => {
    store().addSnapshot('a', snap('s1'))
    store().addSnapshot('a', snap('s2'))
    expect(store().project!.docs.a!.snapshots.map((s) => s.id)).toEqual(['s2', 's1'])
  })

  it('restoring goes through updateContent, not around it', () => {
    store().restoreContent('a', 'restored text')
    expect(store().project!.docs.a!.content).toBe('restored text')
    expect(store().saveStatus).toBe('saving')
  })

  it('removes one by id and leaves the rest', () => {
    store().addSnapshot('a', snap('s1'))
    store().addSnapshot('a', snap('s2'))
    store().removeSnapshot('a', 's1')
    expect(store().project!.docs.a!.snapshots.map((s) => s.id)).toEqual(['s2'])
  })
})

describe('project dictionary', () => {
  it('adds a word once, case-folded', () => {
    store().addDictionaryWord('Mira')
    store().addDictionaryWord('mira')
    expect(store().dictionary.filter((w) => w.toLowerCase() === 'mira')).toHaveLength(1)
  })
  it('removes a word', () => {
    store().addDictionaryWord('Mira')
    store().removeDictionaryWord('Mira')
    expect(store().dictionary).not.toContain('Mira')
  })
})

describe('unloadProject', () => {
  it('leaves nothing from the last project behind', () => {
    store().selectNode('a')
    store().queueProposal(proposal('p1'))
    store().openViewTab('stats')
    store().unloadProject()
    const s = store()
    expect(s.project).toBeNull()
    expect(s.selectedId).toBeNull()
    expect(s.selectedIds).toEqual([])
    expect(s.openTabs).toEqual([])
    expect(s.openViewTabs).toEqual([])
    expect(s.proposals).toEqual([])
    expect(s.mentionIndex.aliasToDocIds.size).toBe(0)
  })
})
