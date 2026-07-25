// voice.ts — the shared voice-drift runner. Scores how closely a passage matches
// the author's voice fingerprint (Foundation → settings.voiceFingerprint). The
// sharp differentiator: "does this scene still sound like *you*?" It only reads
// text; it never writes documents.

import { promptRegistry } from './PromptRegistry'
import { streamCompletion } from './AIClient'

export interface VoiceResult {
  score: number    // 1–10, higher = closer to the fingerprint
  note: string
  at?: string
  words?: number
}

export const VOICE_PROMPT_ID = 'builtin:evaluation:voice-drift'

/** Parse the voice scorer's raw output. Null when unreadable (never fabricates). */
export function parseVoice(raw: string): { score: number; note: string } | null {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const o = JSON.parse(m[0]) as { score?: unknown; note?: unknown }
    if (!Number.isFinite(o.score as number)) return null
    const score = Math.max(1, Math.min(10, Math.round(o.score as number)))
    return { score, note: typeof o.note === 'string' ? o.note : '' }
  } catch {
    return null
  }
}

/** Score a passage against the voice fingerprint. Rejects on unreadable output. */
export async function runVoiceDrift(fingerprint: string, content: string, signal?: AbortSignal): Promise<VoiceResult> {
  const template = promptRegistry.get(VOICE_PROMPT_ID)
  if (!template) throw new Error('Missing voice-drift prompt template')
  const rendered = promptRegistry.render(VOICE_PROMPT_ID, { fingerprint: fingerprint.slice(0, 4000), content: content.slice(0, 8000) })
  const words = content.trim() ? content.trim().split(/\s+/).length : 0
  return new Promise<VoiceResult>((resolve, reject) => {
    streamCompletion(
      [{ role: 'user', content: rendered }],
      { model: template.model, maxTokens: template.maxTokens, temperature: template.temperature, signal },
      {
        onChunk: () => {},
        onDone: (full) => {
          const parsed = parseVoice(full)
          if (!parsed) { reject(new Error('Could not parse voice-drift response')); return }
          resolve({ ...parsed, at: new Date().toISOString(), words })
        },
        onError: reject,
      },
    ).catch(reject)
  })
}
