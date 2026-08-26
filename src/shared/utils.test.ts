import { describe, it, expect } from 'vitest'
import { describeLocation, manuscriptText, wordCount } from './utils'
import { EDITOR_BAR_DEFAULT } from '../store/shellStore'

describe('describeLocation', () => {
  it('says where an OPFS bundle lives in words a novelist would use', () => {
    // The launch screen used to print "opfs:shots" under the project title.
    expect(describeLocation('opfs:shots')).toBe('In this browser')
    expect(describeLocation('opfs:')).toBe('In this browser')
  })

  it('leaves a real path alone — it is already readable', () => {
    expect(describeLocation('/Users/d/Books/Midnight Aisle.konbini'))
      .toBe('/Users/d/Books/Midnight Aisle.konbini')
    expect(describeLocation('Documents/Midnight Aisle.konbini'))
      .toBe('Documents/Midnight Aisle.konbini')
  })

  it('names the placeholder the pickers use', () => {
    expect(describeLocation('browser-pick')).toBe('On this computer')
  })

  it('has nothing to say about nothing', () => {
    expect(describeLocation('')).toBe('')
  })
})

describe('EDITOR_BAR_DEFAULT', () => {
  it('does not repeat what the status bar already says', () => {
    // The editor bar and the status bar both showed "153 words · Ln 1, Col 1",
    // thirty pixels apart. The status bar owns the numbers; this bar owns the
    // controls only a pane can have.
    const on = EDITOR_BAR_DEFAULT.filter((w) => w.visible).map((w) => w.id)
    expect(on).not.toContain('words')
    expect(on).not.toContain('chars')
    expect(on).not.toContain('cursor')
  })

  it('still offers the per-pane controls', () => {
    const on = EDITOR_BAR_DEFAULT.filter((w) => w.visible).map((w) => w.id)
    expect(on).toContain('render')
  })

  it('keeps every widget listed, so split view can turn the counts back on', () => {
    const ids = EDITOR_BAR_DEFAULT.map((w) => w.id)
    for (const id of ['render', 'words', 'chars', 'cursor', 'reading', 'target', 'focus', 'typewriter']) {
      expect(ids).toContain(id)
    }
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('wordCount', () => {
  it('is the one counter — Markdown syntax is not words', () => {
    expect(wordCount('# Reiko Tanaka')).toBe(2)
    expect(wordCount('')).toBe(0)
  })
})

describe('manuscriptText', () => {
  it('unwraps a wikilink to the name a reader should see', () => {
    // Compile joined raw content, so the Shunn export — "the format agents
    // expect" — read `a hum [[Reiko]] had stopped hearing`.
    expect(manuscriptText('a hum [[Reiko]] had stopped hearing'))
      .toBe('a hum Reiko had stopped hearing')
  })

  it('prefers the display half of an aliased link', () => {
    expect(manuscriptText('she nodded at [[Reiko Tanaka|the clerk]]'))
      .toBe('she nodded at the clerk')
  })

  it('falls back to the target when the alias is empty', () => {
    expect(manuscriptText('[[Reiko|]] went home')).toBe('Reiko went home')
  })

  it('handles several links in one line', () => {
    expect(manuscriptText('[[Reiko]] and [[The Night Manager]] and [[Aisle Nine]]'))
      .toBe('Reiko and The Night Manager and Aisle Nine')
  })

  it('leaves Markdown alone — it is the output format, not app syntax', () => {
    const md = '# Heading\n\n**bold**, *italic*, [a link](http://x), `code`\n\n> quote'
    expect(manuscriptText(md)).toBe(md)
  })

  it('leaves ordinary brackets alone', () => {
    expect(manuscriptText('an array [1, 2] and a [link](x)')).toBe('an array [1, 2] and a [link](x)')
  })

  it('has nothing to do to empty prose', () => {
    expect(manuscriptText('')).toBe('')
  })
})
