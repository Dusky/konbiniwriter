import { describe, it, expect } from 'vitest'
import { splitSentences, speakableText, sentenceIndexAt } from './speech'

describe('speakableText', () => {
  it('drops heading markers', () => {
    expect(speakableText('## Chapter One')).toBe('Chapter One')
  })

  it('drops emphasis markers but keeps the words', () => {
    expect(speakableText('The **cold** and *quiet* room')).toBe('The cold and quiet room')
    expect(speakableText('***very*** loud')).toBe('very loud')
    expect(speakableText('~~struck~~ out')).toBe('struck out')
  })

  it('reads a link by its label, not its URL', () => {
    expect(speakableText('See [the map](https://example.com/a/b) here')).toBe('See the map here')
  })

  it('reads a wikilink by its target', () => {
    expect(speakableText('She found [[Reiko]] waiting')).toBe('She found Reiko waiting')
    expect(speakableText('She found [[Reiko|her]] waiting')).toBe('She found Reiko waiting')
  })

  it('drops list and quote markers', () => {
    expect(speakableText('> She said nothing.')).toBe('She said nothing.')
    expect(speakableText('- first\n- second')).toBe('first\nsecond')
  })

  it('reduces a horizontal rule to nothing', () => {
    expect(speakableText('---')).toBe('')
    expect(speakableText('* * *')).toBe('')
  })

  it('leaves plain prose alone', () => {
    expect(speakableText('The door was open.')).toBe('The door was open.')
  })
})

describe('splitSentences', () => {
  const spans = (t: string) => splitSentences(t).map((s) => t.slice(s.from, s.to))

  it('splits on sentence terminators', () => {
    expect(spans('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?'])
  })

  it('reports offsets into the original text', () => {
    const t = 'One. Two.'
    const s = splitSentences(t)
    expect(t.slice(s[1].from, s[1].to)).toBe('Two.')
    expect(s[1].from).toBe(5)
  })

  it('keeps a closing quote with the sentence it ends', () => {
    expect(spans('"Not yet," he said. "It\'s not raining."'))
      .toEqual(['"Not yet," he said.', '"It\'s not raining."'])
  })

  it('does not split on a decimal point', () => {
    expect(spans('It cost 3.50 exactly.')).toEqual(['It cost 3.50 exactly.'])
  })

  it('does not split on a common abbreviation', () => {
    expect(spans('Dr. Tanaka arrived.')).toEqual(['Dr. Tanaka arrived.'])
    expect(spans('Mrs. Ito left at noon.')).toEqual(['Mrs. Ito left at noon.'])
  })

  it('does not split on initials', () => {
    expect(spans('J. R. R. Tolkien wrote it.')).toEqual(['J. R. R. Tolkien wrote it.'])
  })

  it('treats a blank line as a break even without punctuation', () => {
    expect(spans('# Chapter One\n\nThe door opened.'))
      .toEqual(['# Chapter One', 'The door opened.'])
  })

  it('does not break on a single newline inside a paragraph', () => {
    expect(spans('The door\nopened slowly.')).toEqual(['The door\nopened slowly.'])
  })

  it('handles trailing text with no terminator', () => {
    expect(spans('One. And then')).toEqual(['One.', 'And then'])
  })

  it('trims whitespace so the highlight hugs the words', () => {
    const t = '   Spaced out.   '
    const s = splitSentences(t)
    expect(t.slice(s[0].from, s[0].to)).toBe('Spaced out.')
  })

  it('drops spans with nothing speakable in them', () => {
    // The rule between the paragraphs has no words to say.
    const out = splitSentences('One.\n\n---\n\nTwo.')
    expect(out.map((s) => s.speak)).toEqual(['One.', 'Two.'])
  })

  it('carries cleaned text for speech while keeping raw offsets', () => {
    const t = 'The **cold** room.'
    const s = splitSentences(t)
    expect(s[0].speak).toBe('The cold room.')
    expect(t.slice(s[0].from, s[0].to)).toBe('The **cold** room.')
  })

  it('returns nothing for empty or whitespace-only text', () => {
    expect(splitSentences('')).toEqual([])
    expect(splitSentences('   \n\n  ')).toEqual([])
  })

  it('produces spans that never overlap and stay in order', () => {
    const t = 'One. Two! Three?\n\nFour. Five.'
    const s = splitSentences(t)
    for (let i = 1; i < s.length; i++) {
      expect(s[i].from).toBeGreaterThanOrEqual(s[i - 1].to)
    }
  })
})

describe('sentenceIndexAt', () => {
  const t = 'One. Two. Three.'
  const s = splitSentences(t)

  it('finds the sentence containing a position', () => {
    expect(sentenceIndexAt(s, 0)).toBe(0)
    expect(sentenceIndexAt(s, 6)).toBe(1)
    expect(sentenceIndexAt(s, 12)).toBe(2)
  })

  it('clamps past the end to the last sentence', () => {
    expect(sentenceIndexAt(s, 999)).toBe(2)
  })

  it('returns 0 for an empty list rather than -1', () => {
    expect(sentenceIndexAt([], 5)).toBe(0)
  })
})
