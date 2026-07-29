import { describe, it, expect } from 'vitest'
import { splitFootnotes, segmentLine, renderFootnotes, hasFootnotes } from './footnotes'

describe('splitFootnotes', () => {
  it('separates the definitions from the prose, leaving the references', () => {
    const md = 'She paid the toll.[^1]\n\n[^1]: Two coins, always.'
    expect(splitFootnotes(md)).toEqual({
      body: 'She paid the toll.[^1]',
      notes: [{ label: '1', text: 'Two coins, always.' }],
    })
  })

  it('numbers by where the reader meets them, not where they were defined', () => {
    const md = 'A[^b] then B[^a].\n\n[^a]: second\n[^b]: first'
    expect(splitFootnotes(md).notes.map((n) => n.label)).toEqual(['b', 'a'])
  })

  it('joins an indented continuation line onto its definition', () => {
    const md = 'x[^1]\n\n[^1]: The first part\n    and the rest of it.'
    expect(splitFootnotes(md).notes[0]?.text).toBe('The first part and the rest of it.')
  })

  it('keeps a definition nothing refers to rather than dropping the author\'s words', () => {
    const md = 'Nothing points here.\n\n[^orphan]: but it was written'
    expect(splitFootnotes(md).notes).toEqual([{ label: 'orphan', text: 'but it was written' }])
  })

  it('handles a label used twice — one note, one definition', () => {
    const md = 'A[^1] and again[^1].\n\n[^1]: once'
    expect(splitFootnotes(md).notes).toHaveLength(1)
  })

  it('leaves a reference with no definition as plain text', () => {
    const md = 'She paid.[^ghost]'
    expect(splitFootnotes(md)).toEqual({ body: 'She paid.[^ghost]', notes: [] })
  })

  it('passes prose with no footnotes through unchanged', () => {
    expect(splitFootnotes('Just prose.\n\nTwo paragraphs.')).toEqual({
      body: 'Just prose.\n\nTwo paragraphs.',
      notes: [],
    })
  })

  it('does not treat a bracketed aside as a footnote', () => {
    expect(splitFootnotes('He said [see below] and left.').notes).toEqual([])
  })
})

describe('segmentLine', () => {
  it('splits prose around a reference and numbers it by document order', () => {
    expect(segmentLine('She paid.[^a] He left.', ['a'])).toEqual([
      { text: 'She paid.' },
      { ref: 'a', index: 1 },
      { text: ' He left.' },
    ])
  })

  it('numbers a named label by its position, not its name', () => {
    expect(segmentLine('x[^mira-age]', ['1', 'mira-age'])).toEqual([
      { text: 'x' },
      { ref: 'mira-age', index: 2 },
    ])
  })

  it('leaves an undefined reference in the prose instead of inventing a note', () => {
    expect(segmentLine('x[^ghost]y', ['a'])).toEqual([{ text: 'x[^ghost]y' }])
  })

  it('handles two references in one line', () => {
    expect(segmentLine('a[^1]b[^2]c', ['1', '2'])).toEqual([
      { text: 'a' }, { ref: '1', index: 1 },
      { text: 'b' }, { ref: '2', index: 2 },
      { text: 'c' },
    ])
  })

  it('returns the line whole when it has no references', () => {
    expect(segmentLine('plain', ['1'])).toEqual([{ text: 'plain' }])
  })
})

describe('renderFootnotes', () => {
  it('round-trips through splitFootnotes', () => {
    const md = 'A[^1] B[^2]\n\n[^1]: one\n[^2]: two'
    const { body, notes } = splitFootnotes(md)
    expect(splitFootnotes(`${body}\n\n${renderFootnotes(notes)}`).notes).toEqual(notes)
  })
})

describe('hasFootnotes', () => {
  it('is true only when a reference has a definition', () => {
    expect(hasFootnotes('x[^1]\n\n[^1]: y')).toBe(true)
    expect(hasFootnotes('x[^1]')).toBe(false)
    expect(hasFootnotes('plain prose')).toBe(false)
  })
})
