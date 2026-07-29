// The mention index is what makes a codex entry know which scenes it appears
// in, and what lets ContextBuilder send the right entries with a prompt. It is
// rebuilt on every keystroke-batch, so the update path matters more than build.

import { describe, it, expect } from 'vitest'
import { buildIndex, updateIndex, backlinksFor, mentionsIn } from './MentionIndex'

const docs = (m: Record<string, string>) =>
  Object.fromEntries(Object.entries(m).map(([k, content]) => [k, { content }]))

describe('buildIndex', () => {
  it('maps aliases to the documents that mention them', () => {
    const ix = buildIndex(docs({ a: 'Then [[Mira]] left.', b: '[[Mira]] and [[Vass]].' }))
    expect(backlinksFor(ix, 'Mira').sort()).toEqual(['a', 'b'])
    expect(backlinksFor(ix, 'Vass')).toEqual(['b'])
  })

  it('normalises case, so [[MIRA]] and [[mira]] are one entity', () => {
    const ix = buildIndex(docs({ a: '[[MIRA]]', b: '[[mira]]' }))
    expect(backlinksFor(ix, 'Mira').sort()).toEqual(['a', 'b'])
  })

  it('reads the target of a piped link, not its display text', () => {
    const ix = buildIndex(docs({ a: '[[Mira|the ferryman]] waited.' }))
    expect(backlinksFor(ix, 'Mira')).toEqual(['a'])
    expect(backlinksFor(ix, 'the ferryman')).toEqual([])
  })

  it('strips a heading anchor from the target', () => {
    expect(backlinksFor(buildIndex(docs({ a: '[[Mira#history]]' })), 'Mira')).toEqual(['a'])
  })

  it('trims surrounding whitespace inside the brackets', () => {
    expect(backlinksFor(buildIndex(docs({ a: '[[  Mira  ]]' })), 'Mira')).toEqual(['a'])
  })

  it('ignores an empty link rather than indexing a blank alias', () => {
    const ix = buildIndex(docs({ a: '[[]] and [[   ]]' }))
    expect(mentionsIn(ix, 'a')).toEqual([])
  })

  it('does not match a single bracket or an unclosed link', () => {
    const ix = buildIndex(docs({ a: '[Mira] and [[Vass' }))
    expect(mentionsIn(ix, 'a')).toEqual([])
  })

  it('records a document with no mentions, so it can be updated later', () => {
    const ix = buildIndex(docs({ a: 'plain prose' }))
    expect(mentionsIn(ix, 'a')).toEqual([])
    expect(ix.docToAliases.has('a')).toBe(true)
  })

  it('counts a repeated mention once per document', () => {
    expect(backlinksFor(buildIndex(docs({ a: '[[Mira]] [[Mira]] [[Mira]]' })), 'Mira')).toEqual(['a'])
  })
})

describe('updateIndex', () => {
  it('adds the new mentions of a document', () => {
    let ix = buildIndex(docs({ a: 'nothing yet' }))
    ix = updateIndex(ix, 'a', 'now [[Mira]] appears')
    expect(backlinksFor(ix, 'Mira')).toEqual(['a'])
  })

  it('drops a mention the author deleted — the self-healing case', () => {
    let ix = buildIndex(docs({ a: '[[Mira]]', b: '[[Mira]]' }))
    ix = updateIndex(ix, 'a', 'she left')
    expect(backlinksFor(ix, 'Mira')).toEqual(['b'])
    expect(mentionsIn(ix, 'a')).toEqual([])
  })

  it('forgets an alias entirely once its last mention goes', () => {
    let ix = buildIndex(docs({ a: '[[Mira]]' }))
    ix = updateIndex(ix, 'a', 'gone')
    expect(ix.aliasToDocIds.has('mira')).toBe(false)
  })

  it('handles a document the index has never seen', () => {
    const ix = updateIndex(buildIndex({}), 'new', '[[Vass]]')
    expect(backlinksFor(ix, 'Vass')).toEqual(['new'])
  })

  it('returns a new index rather than mutating the one it was given', () => {
    // The store holds this in state; mutating in place would let a component
    // that captured the previous index show data it never rendered for.
    const before = buildIndex(docs({ a: '[[Mira]]' }))
    const after = updateIndex(before, 'a', '[[Vass]]')
    expect(after).not.toBe(before)
    expect(backlinksFor(before, 'Mira')).toEqual(['a'])
    expect(backlinksFor(before, 'Vass')).toEqual([])
    expect(backlinksFor(after, 'Mira')).toEqual([])
    expect(backlinksFor(after, 'Vass')).toEqual(['a'])
  })

  it('leaves other documents\' entries alone', () => {
    let ix = buildIndex(docs({ a: '[[Mira]]', b: '[[Mira]] [[Vass]]' }))
    ix = updateIndex(ix, 'a', '[[Vass]]')
    expect(mentionsIn(ix, 'b').sort()).toEqual(['mira', 'vass'])
    expect(backlinksFor(ix, 'Vass').sort()).toEqual(['a', 'b'])
  })
})

describe('backlinksFor / mentionsIn', () => {
  it('are case-insensitive on the way in', () => {
    expect(backlinksFor(buildIndex(docs({ a: '[[Mira]]' })), 'MIRA')).toEqual(['a'])
  })
  it('return empty for anything unknown, never undefined', () => {
    const ix = buildIndex({})
    expect(backlinksFor(ix, 'nobody')).toEqual([])
    expect(mentionsIn(ix, 'nowhere')).toEqual([])
  })
})
