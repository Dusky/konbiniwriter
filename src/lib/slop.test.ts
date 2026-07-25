import { describe, it, expect } from 'vitest'
import { parseSlopFlags, slopWeight } from './slop'

describe('parseSlopFlags', () => {
  it('extracts a JSON array embedded in prose', () => {
    const raw = 'Here you go:\n[{"excerpt":"a tapestry of","reason":"cliché","severity":"high"}]\nDone.'
    const flags = parseSlopFlags(raw)
    expect(flags).toHaveLength(1)
    expect(flags[0].excerpt).toBe('a tapestry of')
  })
  it('returns [] for no array or invalid JSON, and drops entries without excerpts', () => {
    expect(parseSlopFlags('no issues')).toEqual([])
    expect(parseSlopFlags('[not json]')).toEqual([])
    expect(parseSlopFlags('[{"reason":"x","severity":"low"}]')).toEqual([])
  })
})

describe('slopWeight', () => {
  it('weights high > medium > low', () => {
    expect(slopWeight([
      { excerpt: 'a', reason: '', severity: 'high' },
      { excerpt: 'b', reason: '', severity: 'medium' },
      { excerpt: 'c', reason: '', severity: 'low' },
    ])).toBe(6)
    expect(slopWeight([])).toBe(0)
  })
})
