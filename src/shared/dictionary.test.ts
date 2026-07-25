import { describe, it, expect } from 'vitest'
import { editDistance, buildVocabulary, findNameSlips } from './dictionary'
import { buildProjectFromTemplate } from './templates'
import type { CodexEntry } from './types'

const entry = (name: string, aliases: string[] = []): CodexEntry => ({
  id: name, name, aliases, category: 'character', summary: '', facts: [],
  createdAt: '', modifiedAt: '', aiGenerated: false,
})

describe('editDistance', () => {
  it('is zero for identical strings', () => {
    expect(editDistance('reiko', 'reiko')).toBe(0)
  })

  it('counts a substitution, insertion and deletion as one each', () => {
    expect(editDistance('reiko', 'reico')).toBe(1)
    expect(editDistance('reiko', 'reikoo')).toBe(1)
    expect(editDistance('reiko', 'reik')).toBe(1)
  })

  it('counts a transposition as one edit, not two', () => {
    expect(editDistance('reiko', 'rieko')).toBe(1)
  })

  it('abandons early past the cap rather than computing a big number', () => {
    expect(editDistance('reiko', 'bartholomew', 2)).toBeGreaterThan(2)
  })

  it('respects a caller-supplied cap', () => {
    expect(editDistance('abcd', 'wxyz', 2)).toBeGreaterThan(2)
    expect(editDistance('abcd', 'wxyz', 4)).toBe(4)
  })
})

describe('buildVocabulary', () => {
  it('collects codex names and aliases', () => {
    const v = buildVocabulary(null, [entry('Reiko Tanaka', ['Rei'])])
    expect(v).toContain('Reiko')
    expect(v).toContain('Tanaka')
    // "Rei" is 3 chars, so it survives the length floor.
    expect(v).toContain('Rei')
  })

  it('includes document titles as project vocabulary', () => {
    const p = buildProjectFromTemplate('T', 'novel', '/tmp')
    const v = buildVocabulary(p, [])
    expect(v.map((w) => w.toLowerCase())).toContain('manuscript')
  })

  it('drops words shorter than three letters', () => {
    expect(buildVocabulary(null, [entry('Jo Li')])).toEqual([])
  })

  it('de-duplicates case-insensitively, keeping the first spelling', () => {
    const v = buildVocabulary(null, [entry('Reiko'), entry('REIKO')])
    expect(v).toEqual(['Reiko'])
  })

  it('takes the writer’s own additions', () => {
    expect(buildVocabulary(null, [], ['Konbini'])).toContain('Konbini')
  })
})

describe('findNameSlips', () => {
  const vocab = ['Reiko', 'Tanaka', 'Sunny-Mart']

  it('flags a name that drifted by one keystroke', () => {
    const text = 'The door opened and Reico stepped inside.'
    const slips = findNameSlips(text, vocab)
    expect(slips).toHaveLength(1)
    expect(slips[0].word).toBe('Reico')
    expect(slips[0].suggestion).toBe('Reiko')
    expect(text.slice(slips[0].from, slips[0].to)).toBe('Reico')
  })

  it('catches a transposition', () => {
    expect(findNameSlips('Then Rieko spoke.', vocab)[0]?.suggestion).toBe('Reiko')
  })

  it('leaves correctly spelled names alone', () => {
    expect(findNameSlips('Then Reiko spoke to Tanaka.', vocab)).toEqual([])
  })

  it('flags every occurrence once the token is identified', () => {
    const text = 'Reico waited. Later, Reico left. Reico never returned.'
    // The mid-sentence occurrences establish it as a proper noun; all three
    // are then reported, including the sentence-initial ones.
    expect(findNameSlips(text, vocab)).toHaveLength(3)
  })

  it('does not flag an ordinary word that merely starts a sentence', () => {
    // "The" is one edit from a character named "Thea" — the classic false
    // positive this guard exists to prevent.
    expect(findNameSlips('The room was cold. The door shut.', ['Thea'])).toEqual([])
  })

  it('still flags a proper noun once it appears mid-sentence somewhere', () => {
    const slips = findNameSlips('Thae room was cold. Beside Thae, nothing moved.', ['Thea'])
    expect(slips).toHaveLength(2)
    expect(slips[0].suggestion).toBe('Thea')
  })

  it('requires a closer match for short words', () => {
    // "Ito" -> "Ita" is one edit and flagged; two edits on a short name is not.
    expect(findNameSlips('He met Ita there.', ['Ito'])).toHaveLength(1)
    expect(findNameSlips('He met Ata there.', ['Ito'])).toEqual([])
  })

  it('allows two edits on a longer name', () => {
    // "Barthalemew": two substitutions away from "Bartholomew".
    expect(editDistance('bartholomew', 'barthalemew', 2)).toBe(2)
    expect(findNameSlips('He met Barthalemew there.', ['Bartholomew'])).toHaveLength(1)
  })

  it('ignores unrelated proper nouns with no near match', () => {
    expect(findNameSlips('He met Kowalczyk there.', vocab)).toEqual([])
  })

  it('returns nothing without a vocabulary or without text', () => {
    expect(findNameSlips('Reico stepped in.', [])).toEqual([])
    expect(findNameSlips('', vocab)).toEqual([])
  })

  it('is not fooled by a quotation mark before the sentence', () => {
    // Opening quote must not count as mid-sentence context.
    expect(findNameSlips('"The bell rang," she said.', ['Thea'])).toEqual([])
  })

  it('keeps hyphenated names intact', () => {
    const slips = findNameSlips('She left the Sunny-Mert at dawn.', vocab)
    expect(slips[0]?.word).toBe('Sunny-Mert')
    expect(slips[0]?.suggestion).toBe('Sunny-Mart')
  })
})
