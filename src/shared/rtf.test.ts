import { describe, it, expect } from 'vitest'
import { rtfToText } from './rtf'

const wrap = (body: string) => `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Times;}}${body}}`

describe('rtfToText', () => {
  it('extracts prose and turns \\par into paragraph breaks', () => {
    const out = rtfToText(wrap('\\f0\\fs24 The bell rang.\\par She looked up.'))
    expect(out).toBe('The bell rang.\n\nShe looked up.')
  })

  it('drops metadata tables rather than emitting them as prose', () => {
    const out = rtfToText(`{\\rtf1{\\fonttbl{\\f0 Times New Roman;}}{\\colortbl;\\red0\\green0\\blue0;}Real text.}`)
    expect(out).toBe('Real text.')
    expect(out).not.toMatch(/Times|red0/)
  })

  it('preserves bold and italic as Markdown', () => {
    expect(rtfToText(wrap('Plain \\b bold\\b0  and \\i italic\\i0  end.'))).toContain('**bold**')
    expect(rtfToText(wrap('Plain \\b bold\\b0  and \\i italic\\i0  end.'))).toContain('*italic*')
  })

  it('decodes escapes, unicode and typographic punctuation', () => {
    expect(rtfToText(wrap('caf\\u233 ?'))).toContain('café')
    expect(rtfToText(wrap('\\ldblquote Hi\\rdblquote \\emdash yes'))).toContain('“Hi”—yes')
    expect(rtfToText(wrap('a \\\\ b \\{ c'))).toContain('a \\ b { c')
  })

  it('passes non-RTF text straight through', () => {
    expect(rtfToText('# Already markdown')).toBe('# Already markdown')
  })

  it('collapses runaway blank lines', () => {
    expect(rtfToText(wrap('A\\par\\par\\par\\par B'))).toBe('A\n\nB')
  })
})

describe('footnotes', () => {
  // Scrivener writes a footnote as a reference mark followed immediately by a
  // `{\footnote …}` group. This used to be discarded outright, so importing a
  // researched manuscript silently lost every note in it.
  const withNote = String.raw`{\rtf1\ansi She paid the toll.{\super \chftn}{\footnote \pard\plain {\super \chftn} Two coins, always.} She crossed.}`

  it('recovers the note text instead of discarding it', () => {
    const out = rtfToText(withNote)
    expect(out).toContain('Two coins, always.')
  })

  it('leaves a Markdown reference where the mark was', () => {
    expect(rtfToText(withNote)).toContain('She paid the toll.[^1]')
  })

  it('does not leave the note text inline in the prose', () => {
    const [body] = rtfToText(withNote).split('\n\n[^1]:')
    expect(body).not.toContain('Two coins')
    expect(body).toContain('She crossed.')
  })

  it('files the definitions at the foot, in Markdown syntax', () => {
    expect(rtfToText(withNote)).toMatch(/\n\[\^1\]: Two coins, always\.$/)
  })

  it('numbers several notes in the order they appear', () => {
    const rtf = String.raw`{\rtf1\ansi A{\super \chftn}{\footnote {\super \chftn} first} B{\super \chftn}{\footnote {\super \chftn} second}}`
    const out = rtfToText(rtf)
    expect(out).toContain('A[^1] B[^2]')
    expect(out).toContain('[^1]: first')
    expect(out).toContain('[^2]: second')
  })

  it('keeps emphasis inside a note without leaking it into the prose', () => {
    const rtf = String.raw`{\rtf1\ansi Plain{\super \chftn}{\footnote {\super \chftn} a \i stressed\i0  word} after.}`
    const out = rtfToText(rtf)
    expect(out).toContain('[^1]: a *stressed* word')
    expect(out).toContain('Plain[^1] after.')
  })

  it('adds nothing to a document that has no notes', () => {
    expect(rtfToText(String.raw`{\rtf1\ansi Just prose.}`)).toBe('Just prose.')
  })
})
