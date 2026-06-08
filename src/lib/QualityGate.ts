// QualityGate — reusable eval → revise control loop.
//
// A scorer prompt rates a candidate 0–100 and returns JSON
// `{ overall, issues, suggestions }`; if it falls below the threshold, a reviser
// prompt rewrites it against that critique, and it is re-scored — up to
// `maxRounds` times. This is the gate primitive Autopilot's phase transitions
// reuse: draft → judge → revise-if-weak → advance. It only evaluates text it is
// handed; it never writes documents (callers route the result through the
// proposal pipeline).

import { promptRegistry } from './PromptRegistry'
import { streamCompletion } from './AIClient'

export interface GateScore {
  overall: number        // 0–100
  issues: string[]       // concrete problems found
  suggestions: string[]  // actionable fixes
}

export interface GateOutcome {
  text: string           // the final (possibly revised) candidate
  score: GateScore       // the score of `text`
  rounds: number         // how many revision rounds ran
  passed: boolean        // score.overall >= threshold
}

export interface GateConfig {
  scorePromptId: string
  revisePromptId: string
  /** Pass mark (default 75). */
  threshold?: number
  /** Max revision rounds (default 2). */
  maxRounds?: number
  /** Variables for the score prompt, given the current candidate. */
  scoreVars: (candidate: string) => Record<string, string>
  /** Variables for the revise prompt, given the candidate + joined critique. */
  reviseVars: (candidate: string, critique: string) => Record<string, string>
  signal?: AbortSignal
  /** Streamed revision text (for live preview). */
  onRevise?: (text: string) => void
  /** Coarse progress hook. */
  onPhase?: (phase: 'scoring' | 'revising', round: number) => void
}

function streamOnce(
  promptId: string,
  vars: Record<string, string>,
  signal?: AbortSignal,
  onChunk?: (full: string) => void,
): Promise<string> {
  const template = promptRegistry.get(promptId)
  if (!template) return Promise.reject(new Error(`Missing prompt template: ${promptId}`))
  const rendered = promptRegistry.render(promptId, vars)
  let full = ''
  return new Promise<string>((resolve, reject) => {
    if (signal) signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    streamCompletion(
      [{ role: 'user', content: rendered }],
      { model: template.model, maxTokens: template.maxTokens, temperature: template.temperature, signal },
      { onChunk: (c) => { full += c; onChunk?.(full) }, onDone: resolve, onError: reject },
    ).catch(reject)
  })
}

export function parseGateScore(raw: string): GateScore {
  try {
    const o = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
    return {
      overall: Math.max(0, Math.min(100, Number(o.overall) || 0)),
      issues: Array.isArray(o.issues) ? o.issues.map(String) : [],
      suggestions: Array.isArray(o.suggestions) ? o.suggestions.map(String) : [],
    }
  } catch {
    return { overall: 0, issues: ['Could not parse gate output.'], suggestions: [] }
  }
}

export async function runQualityGate(initial: string, cfg: GateConfig): Promise<GateOutcome> {
  const threshold = cfg.threshold ?? 75
  const maxRounds = cfg.maxRounds ?? 2

  let current = initial
  cfg.onPhase?.('scoring', 0)
  let score = parseGateScore(await streamOnce(cfg.scorePromptId, cfg.scoreVars(current), cfg.signal))

  let round = 0
  while (score.overall < threshold && round < maxRounds) {
    round++
    cfg.onPhase?.('revising', round)
    const critique = [...score.issues, ...score.suggestions].filter(Boolean).join('\n')
    current = (await streamOnce(cfg.revisePromptId, cfg.reviseVars(current, critique), cfg.signal, cfg.onRevise)).trim()
    cfg.onPhase?.('scoring', round)
    score = parseGateScore(await streamOnce(cfg.scorePromptId, cfg.scoreVars(current), cfg.signal))
  }

  return { text: current, score, rounds: round, passed: score.overall >= threshold }
}
