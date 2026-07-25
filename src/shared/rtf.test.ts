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
