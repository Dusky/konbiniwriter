import { describe, it, expect } from 'vitest'
import { reanchor, anchoredFor, openCount, trimAnchor, excerpt, type Comment } from './comments'

const TEXT = 'The red door stood open. Mara hesitated, then stepped through the red door.'

const make = (over: Partial<Comment> & { anchor: Comment['anchor'] }): Comment => ({
  id: 'c1',
  docId: 'd1',
  body: 'note',
  author: 'You',
  origin: 'author',
  createdAt: '2026-01-01T00:00:00.000Z',
  modifiedAt: '2026-01-01T00:00:00.000Z',
  resolved: false,
  ...over,
})

describe('reanchor', () => {
  it('leaves an untouched comment exactly where it was', () => {
    const c = make({ anchor: { from: 4, to: 12, quote: 'red door' } })
    const a = reanchor(c, TEXT)
    expect(a.live).toEqual({ from: 4, to: 12 })
    expect(a.orphaned).toBe(false)
  })

  it('follows the quote when text is inserted above it', () => {
    const c = make({ anchor: { from: 4, to: 12, quote: 'red door' } })
    const shifted = 'Chapter One\n\n' + TEXT
    const a = reanchor(c, shifted)
    expect(shifted.slice(a.live.from, a.live.to)).toBe('red door')
    expect(a.live.from).toBe(17)
    expect(a.orphaned).toBe(false)
  })

  it('picks the occurrence nearest the old offset when the quote repeats', () => {
    // Anchored to the *second* "red door" (offset 66).
    const c = make({ anchor: { from: 66, to: 74, quote: 'red door' } })
    // Delete two characters early in the string so both occurrences shift left.
    const edited = TEXT.replace('The red door', 'A red door')
    const a = reanchor(c, edited)
    // Must resolve to the second occurrence, not the first.
    expect(a.live.from).toBe(edited.lastIndexOf('red door'))
    expect(a.orphaned).toBe(false)
  })

  it('marks a comment orphaned rather than pointing it at the wrong words', () => {
    const c = make({ anchor: { from: 4, to: 12, quote: 'red door' } })
    const a = reanchor(c, 'Nothing here resembles the original sentence at all.')
    expect(a.orphaned).toBe(true)
  })

  it('clamps an orphaned anchor inside the document', () => {
    const c = make({ anchor: { from: 900, to: 950, quote: 'red door' } })
    const a = reanchor(c, 'short')
    expect(a.orphaned).toBe(true)
    expect(a.live.from).toBeLessThanOrEqual(5)
    expect(a.live.to).toBeLessThanOrEqual(5)
  })

  it('treats an empty quote as a point marker, never orphaned', () => {
    const c = make({ anchor: { from: 3, to: 3, quote: '' } })
    const a = reanchor(c, TEXT)
    expect(a.live).toEqual({ from: 3, to: 3 })
    expect(a.orphaned).toBe(false)
  })

  it('does not mutate the comment it is given', () => {
    const c = make({ anchor: { from: 4, to: 12, quote: 'red door' } })
    reanchor(c, 'Chapter One\n\n' + TEXT)
    expect(c.anchor).toEqual({ from: 4, to: 12, quote: 'red door' })
  })
})

describe('anchoredFor', () => {
  const comments: Comment[] = [
    make({ id: 'late', anchor: { from: 66, to: 74, quote: 'red door' } }),
    make({ id: 'done', resolved: true, anchor: { from: 0, to: 3, quote: 'The' } }),
    make({ id: 'early', anchor: { from: 25, to: 29, quote: 'Mara' } }),
    make({ id: 'gone', anchor: { from: 5, to: 9, quote: 'zzzz' } }),
    make({ id: 'other', docId: 'd2', anchor: { from: 0, to: 3, quote: 'The' } }),
  ]

  it('returns only the requested document', () => {
    expect(anchoredFor(comments, 'd1', TEXT).map((c) => c.id)).not.toContain('other')
  })

  it('orders open before orphaned before resolved, then by position', () => {
    expect(anchoredFor(comments, 'd1', TEXT).map((c) => c.id))
      .toEqual(['early', 'late', 'gone', 'done'])
  })
})

describe('openCount', () => {
  it('counts unresolved comments on one document only', () => {
    const comments = [
      make({ id: 'a', anchor: { from: 0, to: 1, quote: 'T' } }),
      make({ id: 'b', resolved: true, anchor: { from: 0, to: 1, quote: 'T' } }),
      make({ id: 'c', docId: 'd2', anchor: { from: 0, to: 1, quote: 'T' } }),
    ]
    expect(openCount(comments, 'd1')).toBe(1)
  })
})

describe('trimAnchor', () => {
  it('strips surrounding whitespace from a selection', () => {
    const t = '  hello  '
    expect(trimAnchor(t, 0, t.length)).toEqual({ from: 2, to: 7 })
  })

  it('normalizes a backwards selection', () => {
    expect(trimAnchor('hello', 4, 1)).toEqual({ from: 1, to: 4 })
  })

  it('leaves an all-whitespace selection empty rather than inverted', () => {
    const r = trimAnchor('a    b', 1, 5)
    expect(r.from).toBe(r.to)
  })

  it('clamps out-of-range offsets', () => {
    expect(trimAnchor('abc', -5, 99)).toEqual({ from: 0, to: 3 })
  })
})

describe('excerpt', () => {
  it('collapses whitespace and passes short quotes through', () => {
    expect(excerpt('the  red\n door')).toBe('the red door')
  })

  it('truncates on a word boundary', () => {
    const long = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo'
    const out = excerpt(long, 30)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(31)
    // The kept text is a whole-word prefix — no word was split in half.
    const kept = out.slice(0, -1)
    expect(long.startsWith(kept)).toBe(true)
    expect(long[kept.length]).toBe(' ')
  })

  it('hard-cuts a single unbroken run rather than returning nothing', () => {
    expect(excerpt('x'.repeat(80), 20)).toBe('x'.repeat(20) + '…')
  })
})
