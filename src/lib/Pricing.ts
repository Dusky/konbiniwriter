// Pricing — USD per 1,000,000 tokens, matched by model-ID substring.
//
// BYOK means users can point at any model/provider, so unknown models return
// null (cost can't be computed) rather than a wrong guess. Rates are current
// Anthropic list prices; OpenAI-compatible providers vary, so only a few common
// ones are seeded — extend as needed. Editable in one place on purpose.

export interface Rate { input: number; output: number }

const RATES: Array<{ match: RegExp; rate: Rate }> = [
  // Anthropic (Claude 5 family; Opus 4.x share one price; Sonnet tiers; Haiku 4.5)
  { match: /fable-5|mythos-5/i, rate: { input: 10, output: 50 } },
  { match: /sonnet-5/i, rate: { input: 3, output: 15 } },
  { match: /opus-4/i, rate: { input: 5, output: 25 } },
  { match: /sonnet-4/i, rate: { input: 3, output: 15 } },
  { match: /haiku-4/i, rate: { input: 1, output: 5 } },
  // A few common OpenAI-compatible defaults (approximate list prices)
  { match: /gpt-4o-mini/i, rate: { input: 0.15, output: 0.6 } },
  { match: /gpt-4o/i, rate: { input: 2.5, output: 10 } },
]

/** List price for a model, or null if unknown (BYOK / local / custom). */
export function rateFor(model: string): Rate | null {
  return RATES.find((r) => r.match.test(model))?.rate ?? null
}

/**
 * USD cost of a call, or null if the model's price is unknown.
 * Cache reads bill at ~0.1× the input rate, cache writes at 1.25×
 * (Anthropic prompt caching, 5-minute TTL).
 */
export function costOf(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheCreationTokens = 0,
): number | null {
  const rate = rateFor(model)
  if (!rate) return null
  return (
    inputTokens * rate.input +
    cacheReadTokens * rate.input * 0.1 +
    cacheCreationTokens * rate.input * 1.25 +
    outputTokens * rate.output
  ) / 1_000_000
}

/** Compact USD formatting: $0.0042, $0.42, $12.30. */
export function formatUSD(amount: number): string {
  if (amount === 0) return '$0.00'
  if (amount < 0.01) return `$${amount.toFixed(4)}`
  if (amount < 1) return `$${amount.toFixed(3)}`
  return `$${amount.toFixed(2)}`
}
