import { describe, it, expect } from 'vitest'
import { rateFor, costOf, formatUSD } from './Pricing'

describe('rateFor', () => {
  it('matches Claude 5 family before older tiers', () => {
    expect(rateFor('claude-fable-5')).toEqual({ input: 10, output: 50 })
    expect(rateFor('claude-sonnet-5')).toEqual({ input: 3, output: 15 })
  })

  it('matches legacy Anthropic tiers', () => {
    expect(rateFor('claude-opus-4-8')).toEqual({ input: 5, output: 25 })
    expect(rateFor('claude-haiku-4-5')).toEqual({ input: 1, output: 5 })
  })

  it('returns null for unknown models', () => {
    expect(rateFor('local-model')).toBeNull()
    expect(rateFor('llama3.3')).toBeNull()
  })
})

describe('costOf', () => {
  it('prices plain input and output', () => {
    // 1M in + 1M out on opus-4-8: $5 + $25
    expect(costOf('claude-opus-4-8', 1_000_000, 1_000_000)).toBeCloseTo(30)
  })

  it('discounts cache reads to 0.1x input rate', () => {
    // 1M cache-read tokens on opus-4-8: $5 * 0.1
    expect(costOf('claude-opus-4-8', 0, 0, 1_000_000, 0)).toBeCloseTo(0.5)
  })

  it('charges cache writes at 1.25x input rate', () => {
    // 1M cache-creation tokens on opus-4-8: $5 * 1.25
    expect(costOf('claude-opus-4-8', 0, 0, 0, 1_000_000)).toBeCloseTo(6.25)
  })

  it('sums all four components', () => {
    const cost = costOf('claude-haiku-4-5', 100_000, 10_000, 200_000, 50_000)
    // (100k*1 + 200k*0.1 + 50k*1.25 + 10k*5) / 1M = (100000 + 20000 + 62500 + 50000) / 1M
    expect(cost).toBeCloseTo(0.2325)
  })

  it('returns null for unknown models', () => {
    expect(costOf('local-model', 1000, 1000)).toBeNull()
  })
})

describe('formatUSD', () => {
  it('formats across magnitudes', () => {
    expect(formatUSD(0)).toBe('$0.00')
    expect(formatUSD(0.0042)).toBe('$0.0042')
    expect(formatUSD(0.42)).toBe('$0.420')
    expect(formatUSD(12.3)).toBe('$12.30')
  })
})
