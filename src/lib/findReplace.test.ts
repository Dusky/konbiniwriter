import { describe, it, expect } from 'vitest'
import { escapeRegExp, makeMatcher, countMatches, replaceWith } from './findReplace'

describe('escapeRegExp', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegExp('a.b*c(d)')).toBe('a\\.b\\*c\\(d\\)')
  })
})

describe('makeMatcher', () => {
  it('is null for an empty query', () => {
    expect(makeMatcher('')).toBeNull()
  })
  it('is case-insensitive by default', () => {
    expect(countMatches('Reiko reiko REIKO', makeMatcher('reiko')!)).toBe(3)
  })
  it('respects caseSensitive', () => {
    expect(countMatches('Reiko reiko REIKO', makeMatcher('reiko', { caseSensitive: true })!)).toBe(1)
  })
  it('matches substrings unless wholeWord', () => {
    expect(countMatches('cat scatter cats', makeMatcher('cat')!)).toBe(3)
  })
  it('respects wholeWord boundaries', () => {
    expect(countMatches('cat scatter cats', makeMatcher('cat', { wholeWord: true })!)).toBe(1)
  })
  it('treats the query literally (metacharacters are escaped)', () => {
    expect(countMatches('a.b axb', makeMatcher('a.b')!)).toBe(1)
  })
  it('still matches a wholeWord query that ends in punctuation', () => {
    // `\b` asserts a transition, so `\bM\.V\.\b` can never match: the char
    // before the closing boundary is a '.', and a space after it is no
    // transition at all. Anchoring only the word-character edges fixes it.
    expect(countMatches('Call her M.V. today.', makeMatcher('M.V.', { wholeWord: true })!)).toBe(1)
  })
  it('anchors the edge that is a word character, even when the other is not', () => {
    expect(countMatches("'Mira and Miranda", makeMatcher("'Mira", { wholeWord: true })!)).toBe(1)
  })
})

describe('replaceWith', () => {
  it('replaces every match', () => {
    expect(replaceWith('Reiko and Reiko', makeMatcher('Reiko')!, 'Mara')).toBe('Mara and Mara')
  })
  it('treats the replacement literally (no $ interpretation)', () => {
    expect(replaceWith('hi there', makeMatcher('there')!, '$& $1')).toBe('hi $& $1')
  })
  it('whole-word replace leaves substrings alone', () => {
    expect(replaceWith('cat scatter', makeMatcher('cat', { wholeWord: true })!, 'dog')).toBe('dog scatter')
  })
})
