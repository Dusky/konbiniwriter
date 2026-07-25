// judge.ts — the shared LLM-judge runner. One path for the Inspector's
// per-scene judge and the manuscript-wide Quality dashboard, so scoring stays
// consistent. It only evaluates the text it's handed; it never writes documents.

import { promptRegistry } from './PromptRegistry'
import { streamCompletion } from './AIClient'

export interface JudgeScore { dimension: string; score: number; note: string }
export interface JudgeResult {
  scores: JudgeScore[]
  verdict: string
  at?: string      // ISO timestamp of the evaluation
  words?: number   // word count of the text evaluated (staleness signal)
}

export const JUDGE_PROMPT_ID = 'builtin:evaluation:judge'

/** One manuscript-wide craft reading, recorded per full "Evaluate all" pass. */
export interface QualityPoint {
  at: string       // ISO timestamp of the pass
  craft: number    // mean craft score across scored scenes (1–10)
  scored: number   // scenes that had a score at that pass
  total: number    // total scenes
}

/** Mean of the dimension scores (the judge rates each 1–10). 0 if none. */
export function judgeOverall(scores: JudgeScore[]): number {
  const valid = scores.filter((s) => Number.isFinite(s.score))
  if (valid.length === 0) return 0
  return valid.reduce((a, s) => a + s.score, 0) / valid.length
}

/** Score → semantic band for colouring (out of 10). */
export function scoreBand(overall: number): 'strong' | 'ok' | 'weak' {
  if (overall >= 8) return 'strong'
  if (overall >= 6) return 'ok'
  return 'weak'
}

/** Run the judge on a passage. Rejects on parse/stream failure (never fabricates). */
export async function runJudge(content: string, signal?: AbortSignal): Promise<JudgeResult> {
  const template = promptRegistry.get(JUDGE_PROMPT_ID)
  if (!template) throw new Error('Missing judge prompt template')
  const rendered = promptRegistry.render(JUDGE_PROMPT_ID, { content: content.slice(0, 8000) })
  const words = content.trim() ? content.trim().split(/\s+/).length : 0
  return new Promise<JudgeResult>((resolve, reject) => {
    streamCompletion(
      [{ role: 'user', content: rendered }],
      { model: template.model, maxTokens: template.maxTokens, temperature: template.temperature, signal },
      {
        onChunk: () => {},
        onDone: (full) => {
          const m = full.match(/\[[\s\S]*?\]/)
          if (!m) { reject(new Error('Could not parse judge response')); return }
          try {
            const scores: JudgeScore[] = JSON.parse(m[0])
            const verdict = full.slice(full.indexOf(m[0]) + m[0].length).trim()
            resolve({ scores, verdict, at: new Date().toISOString(), words })
          } catch { reject(new Error('Could not parse judge response')) }
        },
        onError: reject,
      },
    ).catch(reject)
  })
}
