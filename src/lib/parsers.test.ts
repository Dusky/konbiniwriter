import { describe, it, expect } from 'vitest'
import { parseReaderVerdict, parseBrainstormAlternatives } from './parsers'

describe('parseReaderVerdict', () => {
  it('parses a "keep" verdict', () => {
    expect(parseReaderVerdict('Some critique.\nVERDICT: 82 | keep')).toEqual({ score: 82, keep: true })
  })

  it('parses a "drop" verdict', () => {
    expect(parseReaderVerdict('VERDICT: 40 | drop')).toEqual({ score: 40, keep: false })
  })

  it('treats yes/no as keep/drop', () => {
    expect(parseReaderVerdict('VERDICT: 70 | yes')).toEqual({ score: 70, keep: true })
    expect(parseReaderVerdict('VERDICT: 30 | no')).toEqual({ score: 30, keep: false })
  })

  it('clamps out-of-range scores to 0-100', () => {
    expect(parseReaderVerdict('VERDICT: 150 | keep')).toEqual({ score: 100, keep: true })
  })

  it('returns nulls when no verdict line is present', () => {
    expect(parseReaderVerdict('Just some prose with no verdict.')).toEqual({ score: null, keep: null })
  })
})

describe('parseBrainstormAlternatives', () => {
  it('splits a numbered list into trimmed alternatives', () => {
    const raw = '1. First idea\n2. Second idea\n3. Third idea'
    expect(parseBrainstormAlternatives(raw)).toEqual(['First idea', 'Second idea', 'Third idea'])
  })

  it('caps at 5 alternatives', () => {
    const raw = Array.from({ length: 8 }, (_, i) => `${i + 1}. Idea ${i + 1}`).join('\n')
    expect(parseBrainstormAlternatives(raw)).toHaveLength(5)
  })

  it('returns [] when fewer than 2 numbered items are found', () => {
    expect(parseBrainstormAlternatives('1. Only one idea')).toEqual([])
    expect(parseBrainstormAlternatives('No numbered items here.')).toEqual([])
  })
})
