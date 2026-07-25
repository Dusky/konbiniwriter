import { describe, it, expect } from 'vitest'
import { parseVoice } from './voice'

describe('parseVoice', () => {
  it('parses score + note and clamps to 1–10', () => {
    expect(parseVoice('{"score": 8, "note": "nails the dry wit"}')).toEqual({ score: 8, note: 'nails the dry wit' })
    expect(parseVoice('prefix {"score": 12, "note": "x"} suffix')?.score).toBe(10)
    expect(parseVoice('{"score": -3, "note": "y"}')?.score).toBe(1)
  })
  it('returns null when unreadable or score missing', () => {
    expect(parseVoice('no json')).toBeNull()
    expect(parseVoice('{"note":"x"}')).toBeNull()
    expect(parseVoice('{"score":"high"}')).toBeNull()
  })
})
