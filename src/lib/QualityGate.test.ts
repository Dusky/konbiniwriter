import { describe, it, expect } from 'vitest'
import { parseGateScore } from './QualityGate'

describe('parseGateScore', () => {
  it('parses a well-formed score object', () => {
    const raw = '{"overall": 82, "issues": ["pacing"], "suggestions": ["trim the middle"]}'
    expect(parseGateScore(raw)).toEqual({ overall: 82, issues: ['pacing'], suggestions: ['trim the middle'] })
  })

  it('extracts JSON embedded in surrounding prose', () => {
    const raw = 'Here is my evaluation:\n{"overall": 60, "issues": [], "suggestions": []}\nThanks!'
    expect(parseGateScore(raw)?.overall).toBe(60)
  })

  it('clamps overall to 0-100', () => {
    expect(parseGateScore('{"overall": 150}')?.overall).toBe(100)
    expect(parseGateScore('{"overall": -10}')?.overall).toBe(0)
  })

  it('defaults issues/suggestions to [] when missing or malformed', () => {
    expect(parseGateScore('{"overall": 70}')).toEqual({ overall: 70, issues: [], suggestions: [] })
  })

  it('returns null for non-JSON output', () => {
    expect(parseGateScore('I refuse to output JSON.')).toBeNull()
  })

  it('returns null when overall is missing or not a finite number', () => {
    expect(parseGateScore('{"issues": ["x"]}')).toBeNull()
    expect(parseGateScore('{"overall": "not a number"}')).toBeNull()
    expect(parseGateScore('{"overall": null}')).toBeNull()
  })
})
