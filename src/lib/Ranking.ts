// Ranking — comparative evaluation via pairwise LLM judging + Elo.
//
// Where QualityGate scores a candidate in isolation (absolute), Ranking compares
// candidates against each other (relative) to pick a winner from N variants. A
// judge prompt returns A / B / tie for each pair; ratings update by Elo. This is
// the primitive behind "best of N" generation. Read-only — callers route the
// winner through the proposal pipeline.

import { promptRegistry } from './PromptRegistry'
import { streamCompletion } from './AIClient'

export interface RankedVariant {
  index: number      // original position in the input array
  text: string
  rating: number     // Elo
  wins: number
  losses: number
  ties: number
}

export interface RankConfig {
  comparePromptId: string
  /** Variables for the compare prompt given the two candidate texts. */
  compareVars: (a: string, b: string) => Record<string, string>
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
}

const K = 32
const BASE = 1000

function judgePair(promptId: string, vars: Record<string, string>, signal?: AbortSignal): Promise<'A' | 'B' | 'tie'> {
  const template = promptRegistry.get(promptId)
  if (!template) return Promise.reject(new Error(`Missing prompt template: ${promptId}`))
  const rendered = promptRegistry.render(promptId, vars)
  return new Promise((resolve, reject) => {
    if (signal) signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    streamCompletion(
      [{ role: 'user', content: rendered }],
      { model: template.model, maxTokens: template.maxTokens, temperature: template.temperature, signal },
      {
        onChunk: () => {},
        onDone: (full) => {
          try {
            const o = JSON.parse(full.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
            const w = String(o.winner ?? '').trim().toUpperCase()
            resolve(w === 'A' ? 'A' : w === 'B' ? 'B' : 'tie')
          } catch { resolve('tie') }
        },
        onError: reject,
      },
    ).catch(reject)
  })
}

/**
 * Round-robin pairwise ranking. Each unordered pair is judged once; to blunt
 * position bias, the side presented as "A" is alternated. Returns variants
 * sorted best-first by Elo.
 */
export async function rankVariants(variants: string[], cfg: RankConfig): Promise<RankedVariant[]> {
  const v: RankedVariant[] = variants.map((text, index) => ({ index, text, rating: BASE, wins: 0, losses: 0, ties: 0 }))
  const pairs: Array<[number, number]> = []
  for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) pairs.push([i, j])

  let done = 0
  cfg.onProgress?.(0, pairs.length)
  let flip = false
  for (const [i, j] of pairs) {
    // Alternate which variant is shown first to reduce A/B position bias.
    const [first, second] = flip ? [j, i] : [i, j]
    flip = !flip
    const verdict = await judgePair(cfg.comparePromptId, cfg.compareVars(v[first].text, v[second].text), cfg.signal)
    const winner = verdict === 'tie' ? 'tie' : verdict === 'A' ? first : second

    const ei = 1 / (1 + Math.pow(10, (v[j].rating - v[i].rating) / 400))
    const si = winner === 'tie' ? 0.5 : winner === i ? 1 : 0
    v[i].rating += K * (si - ei)
    v[j].rating += K * ((1 - si) - (1 - ei))
    if (winner === 'tie') { v[i].ties++; v[j].ties++ }
    else if (winner === i) { v[i].wins++; v[j].losses++ }
    else { v[j].wins++; v[i].losses++ }

    cfg.onProgress?.(++done, pairs.length)
  }

  return [...v].sort((a, b) => b.rating - a.rating)
}
