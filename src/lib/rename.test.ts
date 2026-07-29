// Renaming a character is the operation most likely to leave the project
// quietly inconsistent, so the planner is tested on every place a name hides:
// prose, node titles, synopses, binder keywords, the codex, and the quoted text
// comments recover themselves by.

import { describe, it, expect } from 'vitest'
import { planRename, describePlan, NAME_DEFAULTS } from './rename'
import type { CodexEntry, KNode, Project } from '@shared/types'
import type { Comment } from '@shared/comments'

const node = (id: string, title: string, patch: Partial<KNode> = {}): KNode => ({
  id, type: 'scene', title, parentId: null, childIds: [], expanded: true,
  meta: { label: 'scene', status: 'draft', synopsis: '', target: 0, includeInCompile: true, keywords: [] },
  ext: {}, rev: 1, modified: '', ...patch,
})

const entry = (patch: Partial<CodexEntry> = {}): CodexEntry => ({
  id: 'e1', name: 'Mira', aliases: ['Mira Vance'], category: 'character',
  summary: 'Mira runs the ferry.', facts: [{ id: 'f1', label: 'role', value: 'Mira pilots it', aiGenerated: false, confirmedAt: null }],
  createdAt: '', modifiedAt: '', aiGenerated: false, ...patch,
})

const comment = (patch: Partial<Comment> = {}): Comment => ({
  id: 'c1', docId: 'd1', anchor: { from: 0, to: 4, quote: 'Mira waited.' },
  body: 'Would Mira really wait?', author: 'me', origin: 'author', createdAt: '', resolved: false, ...patch,
} as Comment)

function make(patch: Partial<Project> = {}): Project {
  return {
    schemaVersion: 2, id: 'p', title: 'Book', created: '', modified: '',
    rootIds: ['d1'], trashId: 'trash',
    nodes: { d1: node('d1', 'Scene One'), trash: node('trash', 'Trash', { type: 'folder' }) },
    docs: { d1: { content: '', snapshots: [] } },
    settings: { location: '', codex: [], comments: [] },
    ...patch,
  } as Project
}

describe('planRename', () => {
  it('rewrites prose, and counts every occurrence', () => {
    const p = make({ docs: { d1: { content: 'Mira rowed. Mira did not look back.', snapshots: [] } } })
    const plan = planRename(p, 'Mira', 'Sera')
    expect(plan.docs).toHaveLength(1)
    expect(plan.docs[0]?.count).toBe(2)
    expect(plan.docs[0]?.proposed).toBe('Sera rowed. Sera did not look back.')
    expect(plan.total).toBe(2)
  })

  it('renames the node title that project-wide replace leaves stale', () => {
    const p = make({ nodes: { d1: node('d1', 'Mira and the River'), trash: node('trash', 'Trash', { type: 'folder' }) } })
    const plan = planRename(p, 'Mira', 'Sera')
    expect(plan.titles).toEqual([{ id: 'd1', where: 'Mira and the River', from: 'Mira and the River', to: 'Sera and the River' }])
  })

  it('renames synopses', () => {
    const p = make({
      nodes: {
        d1: node('d1', 'Scene One', { meta: { ...node('d1', 'x').meta, synopsis: 'Mira leaves.' } }),
        trash: node('trash', 'Trash', { type: 'folder' }),
      },
    })
    expect(planRename(p, 'Mira', 'Sera').synopses[0]?.to).toBe('Sera leaves.')
  })

  describe('keywords', () => {
    const withKeywords = (keywords: string[]) => make({
      nodes: {
        d1: node('d1', 'Scene One', { meta: { ...node('d1', 'x').meta, keywords } }),
        trash: node('trash', 'Trash', { type: 'folder' }),
      },
    })

    it('renames a lowercase tag even under a case-sensitive rename', () => {
      // Tags are slugs. Skipping them would leave the binder filtering on a
      // name the book no longer contains — the exact staleness this prevents.
      expect(planRename(withKeywords(['pov-mira', 'river']), 'Mira', 'Sera').keywords[0]?.to)
        .toEqual(['pov-sera', 'river'])
    })

    it('keeps the case the tag was already using', () => {
      expect(planRename(withKeywords(['Mira', 'MIRA', 'pov-mira']), 'Mira', 'Sera').keywords[0]?.to)
        .toEqual(['Sera', 'SERA', 'pov-sera'])
    })

    it('leaves tags that only contain the name as a fragment', () => {
      expect(planRename(withKeywords(['admiral']), 'Mira', 'Sera').empty).toBe(true)
    })
  })

  it('carries the codex entry, its aliases, summary and facts', () => {
    const p = make({ settings: { location: '', codex: [entry()], comments: [] } } as Partial<Project>)
    const plan = planRename(p, 'Mira', 'Sera')
    expect(plan.codex).toHaveLength(1)
    expect(plan.codex[0]?.changed.sort()).toEqual(['aliases', 'facts', 'name', 'summary'])
    expect(plan.codex[0]?.next.name).toBe('Sera')
    expect(plan.codex[0]?.next.aliases).toEqual(['Sera Vance'])
    expect(plan.codex[0]?.next.summary).toBe('Sera runs the ferry.')
    expect(plan.codex[0]?.next.facts[0]?.value).toBe('Sera pilots it')
  })

  it('rewrites the quote a comment recovers itself by — the orphan case', () => {
    const p = make({ settings: { location: '', codex: [], comments: [comment()] } } as Partial<Project>)
    const plan = planRename(p, 'Mira', 'Sera')
    expect(plan.comments).toHaveLength(1)
    expect(plan.comments[0]?.anchor.quote).toBe('Sera waited.')
    expect(plan.comments[0]?.body).toBe('Would Sera really wait?')
    expect(plan.comments[0]?.changed.sort()).toEqual(['body', 'quote'])
  })

  it('keeps a comment whose body mentions the name but whose quote does not', () => {
    const c = comment({ anchor: { from: 0, to: 3, quote: 'The river said nothing.' } })
    const p = make({ settings: { location: '', codex: [], comments: [c] } } as Partial<Project>)
    expect(planRename(p, 'Mira', 'Sera').comments[0]?.changed).toEqual(['body'])
  })

  it('leaves the trash alone', () => {
    const p = make({ nodes: { trash: node('trash', 'Mira', { type: 'folder' }) }, rootIds: ['trash'], docs: {} })
    expect(planRename(p, 'Mira', 'Sera').empty).toBe(true)
  })

  describe('matching', () => {
    const withProse = (content: string) => make({ docs: { d1: { content, snapshots: [] } } })

    it('does not rename a name inside another word', () => {
      expect(planRename(withProse('The admiral waited.'), 'mira', 'sera', NAME_DEFAULTS).empty).toBe(true)
    })

    it('catches a wikilink, because brackets are word boundaries', () => {
      expect(planRename(withProse('See [[Mira]].'), 'Mira', 'Sera').docs[0]?.proposed).toBe('See [[Sera]].')
    })

    it('catches a possessive, and keeps the apostrophe', () => {
      expect(planRename(withProse("Mira's boat."), 'Mira', 'Sera').docs[0]?.proposed).toBe("Sera's boat.")
    })

    it('leaves a shouted spelling alone by default, rather than downcasing it', () => {
      // Case-sensitive by default: "MIRA!" is a choice the author made.
      expect(planRename(withProse('MIRA! he called.'), 'Mira', 'Sera').empty).toBe(true)
      expect(planRename(withProse('MIRA! he called.'), 'Mira', 'Sera', { wholeWord: true, caseSensitive: false })
        .docs[0]?.proposed).toBe('Sera! he called.')
    })

    it('treats a replacement containing $ literally, not as a backreference', () => {
      expect(planRename(withProse('Mira paid.'), 'Mira', '$&x').docs[0]?.proposed).toBe('$&x paid.')
    })

    it('escapes regex metacharacters in the name', () => {
      expect(planRename(withProse('Call her M.V. today.'), 'M.V.', 'Sera').docs[0]?.proposed).toBe('Call her Sera today.')
    })
  })

  describe('refusals', () => {
    it('plans nothing for an empty or unchanged name', () => {
      const p = make({ docs: { d1: { content: 'Mira.', snapshots: [] } } })
      expect(planRename(p, '', 'Sera').empty).toBe(true)
      expect(planRename(p, 'Mira', '').empty).toBe(true)
      expect(planRename(p, 'Mira', 'Mira').empty).toBe(true)
      expect(planRename(p, '   ', 'Sera').empty).toBe(true)
    })

    it('plans nothing when the name appears nowhere', () => {
      expect(planRename(make(), 'Mira', 'Sera').empty).toBe(true)
    })
  })
})

describe('describePlan', () => {
  it('says what will change, in the author\'s units', () => {
    const p = make({
      nodes: { d1: node('d1', 'Mira and the River'), trash: node('trash', 'Trash', { type: 'folder' }) },
      docs: { d1: { content: 'Mira rowed. Mira waited.', snapshots: [] } },
      settings: { location: '', codex: [entry()], comments: [] },
    } as Partial<Project>)
    expect(describePlan(planRename(p, 'Mira', 'Sera')))
      .toBe('2 mentions in 1 document · 1 title · 1 codex entry')
  })

  it('is honest when there is nothing to do', () => {
    expect(describePlan(planRename(make(), 'Mira', 'Sera'))).toBe('Nothing matches')
  })
})
