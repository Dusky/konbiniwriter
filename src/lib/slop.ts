// slop.ts — the shared slop-proofing runner. One path for the editor's inline
// proof underlines and the Quality dashboard's per-scene slop count. Flags
// clichés, filler, and AI-sounding constructions; it never writes documents.

import { promptRegistry } from './PromptRegistry'
import { streamCompletion } from './AIClient'

export type SlopSeverity = 'low' | 'medium' | 'high'
export interface SlopFlag { excerpt: string; reason: string; severity: SlopSeverity }
export interface SlopResult { flags: SlopFlag[]; at?: string; words?: number }

const SLOP_PROMPT_ID = 'builtin:evaluation:slop'

/** Parse the slop scorer's raw output into flags. Tolerant of prose around the JSON. */
export function parseSlopFlags(raw: string): SlopFlag[] {
  const m = raw.match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    const arr = JSON.parse(m[0]) as SlopFlag[]
    return Array.isArray(arr)
      ? arr.filter((f) => f && typeof f.excerpt === 'string' && f.excerpt.length > 0)
      : []
  } catch {
    return []
  }
}

/** Weighted slop score: high flags hurt more than low ones. */
export function slopWeight(flags: SlopFlag[]): number {
  return flags.reduce((a, f) => a + (f.severity === 'high' ? 3 : f.severity === 'medium' ? 2 : 1), 0)
}

/** Run the slop scorer on a passage. Returns [] on parse failure (never throws for that). */
export async function runSlop(content: string, signal?: AbortSignal): Promise<SlopResult> {
  const template = promptRegistry.get(SLOP_PROMPT_ID)
  if (!template) throw new Error('Missing slop prompt template')
  const rendered = promptRegistry.render(SLOP_PROMPT_ID, { content })
  const words = content.trim() ? content.trim().split(/\s+/).length : 0
  return new Promise<SlopResult>((resolve, reject) => {
    streamCompletion(
      [{ role: 'user', content: rendered }],
      { model: template.model, maxTokens: template.maxTokens, temperature: template.temperature, signal },
      {
        onChunk: () => {},
        onDone: (full) => resolve({ flags: parseSlopFlags(full), at: new Date().toISOString(), words }),
        onError: reject,
      },
    ).catch(reject)
  })
}
