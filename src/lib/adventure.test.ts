// The parsers stand between a model's output and the author's manuscript, so
// they are the part of adventure mode that must never throw and never invent.
// Everything here is a shape a real model has returned for a "give me JSON"
// prompt: fenced, prefaced, half-finished, or quietly the wrong type.

import { describe, it, expect } from 'vitest'
import {
  parseOptions,
  parseNotes,
  unseenCandidates,
  precedingText,
  appendPassage,
  spineLine,
  words,
  MAX_OPTIONS,
} from './adventure'
import type { CodexEntry } from '@shared/types'

const codexEntry = (name: string, aliases: string[] = []): CodexEntry => ({
  id: name, name, aliases, category: 'character', summary: '', facts: [],
  createdAt: '', modifiedAt: '', aiGenerated: false,
})

describe('parseOptions', () => {
  it('reads the deck the prompt asks for', () => {
    const raw = '[{"text":"She lies about the letter","endScene":false},{"text":"The ferryman returns early","endScene":false}]'
    expect(parseOptions(raw)).toEqual([
      { text: 'She lies about the letter' },
      { text: 'The ferryman returns early' },
    ])
  })

  it('finds the array inside a fence and a preamble', () => {
    const raw = 'Sure! Here are three directions:\n\n```json\n[{"text":"He burns it"}]\n```\n\nHope that helps.'
    expect(parseOptions(raw)).toEqual([{ text: 'He burns it' }])
  })

  it('accepts a bare array of strings', () => {
    // Smaller models frequently ignore the object shape and just list them.
    expect(parseOptions('["He burns it","She leaves"]')).toEqual([
      { text: 'He burns it' },
      { text: 'She leaves' },
    ])
  })

  it('keeps the scene-end flag only when it is actually set', () => {
    const raw = '[{"text":"They part at the dock","endScene":true},{"text":"She follows him","endScene":false}]'
    expect(parseOptions(raw)).toEqual([
      { text: 'They part at the dock', endScene: true },
      { text: 'She follows him' },
    ])
  })

  it('treats a stringy "true" as not set, rather than guessing', () => {
    expect(parseOptions('[{"text":"They part","endScene":"true"}]')).toEqual([{ text: 'They part' }])
  })

  it('drops duplicates — two identical cards are not a choice', () => {
    const raw = '[{"text":"She lies"},{"text":"she lies"},{"text":"He knows"}]'
    expect(parseOptions(raw)).toEqual([{ text: 'She lies' }, { text: 'He knows' }])
  })

  it('drops blanks and non-strings instead of rendering empty cards', () => {
    expect(parseOptions('[{"text":"  "},{"text":42},{"text":"Real one"},null]')).toEqual([{ text: 'Real one' }])
  })

  it('caps the deck so a runaway response cannot flood the UI', () => {
    const raw = JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ text: `beat ${i}` })))
    expect(parseOptions(raw)).toHaveLength(MAX_OPTIONS)
  })

  it('returns nothing for truncated, empty, or non-JSON output', () => {
    expect(parseOptions('[{"text":"She li')).toEqual([])
    expect(parseOptions('')).toEqual([])
    expect(parseOptions('I could not think of any.')).toEqual([])
    expect(parseOptions('{"text":"not an array"}')).toEqual([])
  })
})

describe('parseNotes', () => {
  it('reads candidates and normalises their parts', () => {
    const raw = `[{"name":"The ferryman","category":"character","aliases":["Old Vass"],"summary":"Ferries the dead.","facts":[{"label":"role","value":"ferryman"}]}]`
    expect(parseNotes(raw)).toEqual([{
      name: 'The ferryman',
      category: 'character',
      aliases: ['Old Vass'],
      summary: 'Ferries the dead.',
      facts: [{ label: 'role', value: 'ferryman' }],
    }])
  })

  it('falls back to `character` for an unknown category rather than dropping the entry', () => {
    expect(parseNotes('[{"name":"The Compact","category":"faction"}]')[0]?.category).toBe('character')
  })

  it('never files something unnamed', () => {
    expect(parseNotes('[{"category":"location","summary":"a place"},{"name":"  "}]')).toEqual([])
  })

  it('drops half-written facts instead of storing an empty value', () => {
    const parsed = parseNotes('[{"name":"Mira","facts":[{"label":"age"},{"label":"eyes","value":"grey"},{"value":"orphan"}]}]')
    expect(parsed[0]?.facts).toEqual([{ label: 'eyes', value: 'grey' }])
  })

  it('tolerates the wrong type where a list was asked for', () => {
    const parsed = parseNotes('[{"name":"Mira","aliases":"none","facts":"unknown"}]')
    expect(parsed[0]).toMatchObject({ name: 'Mira', aliases: [], facts: [] })
  })

  it('returns nothing for the empty answer, which is the common one', () => {
    expect(parseNotes('[]')).toEqual([])
    expect(parseNotes('Nothing new in this passage.')).toEqual([])
  })
})

describe('unseenCandidates', () => {
  const found = [
    { name: 'Mira', category: 'character' as const, aliases: [], summary: '', facts: [] },
    { name: 'The Ferryman', category: 'character' as const, aliases: ['Vass'], summary: '', facts: [] },
  ]

  it('hides what the codex already holds, case-insensitively', () => {
    expect(unseenCandidates(found, [codexEntry('mira')]).map((c) => c.name)).toEqual(['The Ferryman'])
  })

  it('matches against existing aliases too', () => {
    expect(unseenCandidates(found, [codexEntry('Old Man', ['the ferryman'])]).map((c) => c.name)).toEqual(['Mira'])
  })

  it('does not treat a near-miss as a match — a new entry is better than a lost one', () => {
    // "ferryman" is not "The Ferryman". The prompt asks the model to skip close
    // matches; guessing at them here would hide entities the story just added.
    expect(unseenCandidates(found, [codexEntry('Old Man', ['ferryman'])]).map((c) => c.name)).toEqual(['Mira', 'The Ferryman'])
  })

  it('matches when the candidate is known under one of its own aliases', () => {
    expect(unseenCandidates(found, [codexEntry('Vass')]).map((c) => c.name)).toEqual(['Mira'])
  })

  it('passes everything through when the codex is empty', () => {
    expect(unseenCandidates(found, [])).toHaveLength(2)
  })
})

describe('precedingText', () => {
  it('returns a short scene whole', () => {
    expect(precedingText('Two lines.\n\nAnd a second.')).toBe('Two lines.\n\nAnd a second.')
  })

  it('keeps the END of a long scene — continuation needs the tail, not the head', () => {
    const long = 'START' + 'x'.repeat(500) + '\n\nfinal paragraph.'
    const out = precedingText(long, 100)
    expect(out).toBe('final paragraph.')
    expect(out).not.toContain('START')
  })

  it('falls back to a raw slice when the tail has no paragraph break', () => {
    const out = precedingText('y'.repeat(300), 50)
    expect(out).toHaveLength(50)
  })

  it('drops trailing whitespace so the model does not continue a blank line', () => {
    expect(precedingText('He waited.\n\n\n')).toBe('He waited.')
  })
})

describe('appendPassage', () => {
  it('separates the new passage with one blank line', () => {
    expect(appendPassage('First.', 'Second.')).toBe('First.\n\nSecond.')
  })

  it('does not open a scene with a blank line', () => {
    expect(appendPassage('', 'Opening.')).toBe('Opening.')
  })

  it('normalises whatever trailing whitespace the document had', () => {
    expect(appendPassage('First.\n\n\n', '  Second.  ')).toBe('First.\n\nSecond.')
  })

  it('leaves the document untouched when the model returned nothing', () => {
    expect(appendPassage('First.', '   ')).toBe('First.')
  })
})

describe('spineLine', () => {
  const beat = { text: 'She lies about the letter', sceneId: 's1', at: '' }

  it('adds a heading when the beat opens a new scene', () => {
    expect(spineLine(beat, 'Scene 2', true)).toBe('\n## Scene 2\n\n- She lies about the letter\n')
  })

  it('is one line inside a scene, so the spine only ever grows', () => {
    expect(spineLine(beat, 'Scene 2', false)).toBe('- She lies about the letter\n')
  })
})

describe('words', () => {
  it('counts words, not whitespace', () => {
    expect(words('  one   two\nthree ')).toBe(3)
    expect(words('   ')).toBe(0)
  })
})
