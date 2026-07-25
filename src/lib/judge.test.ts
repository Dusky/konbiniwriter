import { describe, it, expect } from 'vitest'
import { judgeOverall, scoreBand } from './judge'

describe('judgeOverall', () => {
  it('averages the dimension scores', () => {
    expect(judgeOverall([
      { dimension: 'a', score: 8, note: '' },
      { dimension: 'b', score: 6, note: '' },
    ])).toBe(7)
  })
  it('ignores non-finite scores and returns 0 for empty', () => {
    expect(judgeOverall([])).toBe(0)
    expect(judgeOverall([{ dimension: 'a', score: NaN, note: '' }, { dimension: 'b', score: 9, note: '' }])).toBe(9)
  })
})

describe('scoreBand', () => {
  it('bands by threshold', () => {
    expect(scoreBand(9)).toBe('strong')
    expect(scoreBand(8)).toBe('strong')
    expect(scoreBand(7)).toBe('ok')
    expect(scoreBand(6)).toBe('ok')
    expect(scoreBand(5.9)).toBe('weak')
    expect(scoreBand(0)).toBe('weak')
  })
})
