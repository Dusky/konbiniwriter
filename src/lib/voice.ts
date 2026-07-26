// voice.ts — the shared voice-drift runner. Scores how closely a passage matches
// the author's voice fingerprint (Foundation → settings.voiceFingerprint). The
// sharp differentiator: "does this scene still sound like *you*?" It only reads
// text; it never writes documents.

import { promptRegistry } from './PromptRegistry'
import { streamCompletion } from './AIClient'
import { uid } from '@shared/utils'
import type { ID, Project, ProjectSettings, VoiceProfile } from '@shared/types'

export interface VoiceResult {
  score: number    // 1–10, higher = closer to the fingerprint
  note: string
  at?: string
  words?: number
}

export const VOICE_PROMPT_ID = 'builtin:evaluation:voice-drift'

/** Analyse existing prose. */
export const VOICE_FROM_SAMPLES_ID = 'builtin:foundation:voice'
/** Author a target voice from a description, before any prose exists. */
export const VOICE_FROM_BRIEF_ID = 'builtin:foundation:voice-brief'

/** How much of a brief / reference passage is worth sending. */
const BRIEF_LIMIT = 4000
const REFERENCE_LIMIT = 6000

export type VoiceSource =
  | { from: 'samples'; samples: string }
  | { from: 'brief'; brief: string; reference?: string }

/**
 * Produce a voice fingerprint, streaming as it goes.
 *
 * Both callers (Foundation's voice step and AI Settings) were hand-rolling this
 * against `streamCompletion` with their own abort handling and their own copy of
 * the model/token plumbing. One runner, so a fix to either path is a fix to
 * both, and so the prompt id stays the registry's business rather than a string
 * duplicated across components.
 *
 * `onChunk` receives the text accumulated so far, not the delta — callers render
 * it straight into a textarea.
 */
export function generateVoiceFingerprint(
  source: VoiceSource,
  onChunk: (soFar: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const id = source.from === 'samples' ? VOICE_FROM_SAMPLES_ID : VOICE_FROM_BRIEF_ID
  const template = promptRegistry.get(id)
  if (!template) return Promise.reject(new Error(`Missing prompt template: ${id}`))

  const vars: Record<string, string> = source.from === 'samples'
    ? { samples: source.samples }
    : {
        brief: source.brief.slice(0, BRIEF_LIMIT),
        // The prompt branches on this being empty, so pass '' rather than
        // leaving the variable unrendered.
        reference: (source.reference ?? '').slice(0, REFERENCE_LIMIT),
      }
  const rendered = promptRegistry.render(id, vars)

  return new Promise<string>((resolve, reject) => {
    let full = ''
    streamCompletion(
      [{ role: 'user', content: rendered }],
      { model: template.model, maxTokens: template.maxTokens, temperature: template.temperature, signal },
      {
        onChunk: (c) => { full += c; onChunk(full) },
        onDone: (result) => resolve(result.trim()),
        onError: reject,
      },
    ).catch(reject)
  })
}

// ── Voice profiles ───────────────────────────────────────────────────────────

export const DEFAULT_VOICE_NAME = 'Main voice'

/** A new profile, ready to store. */
export function makeVoiceProfile(name: string, fingerprint: string): VoiceProfile {
  const now = new Date().toISOString()
  return { id: uid('voice'), name: name.trim() || DEFAULT_VOICE_NAME, fingerprint, createdAt: now, modifiedAt: now }
}

/**
 * Bring a project's settings up to the profile model.
 *
 * Projects written before profiles existed carry a single
 * `settings.voiceFingerprint` string. That becomes one named profile and the
 * active one, so nothing is lost and nothing needs the author's attention.
 * Idempotent — safe to run on every load.
 *
 * Returns null when there is nothing to change, so callers can skip the write.
 */
export function migrateVoiceProfiles(settings: ProjectSettings): Partial<ProjectSettings> | null {
  const profiles = settings.voiceProfiles
  if (profiles?.length) {
    // Already migrated. Repair a dangling active id rather than resolving to
    // nothing — a deleted profile shouldn't silently turn the voice off.
    if (settings.activeVoiceId && profiles.some((p) => p.id === settings.activeVoiceId)) return null
    const first = profiles[0]!
    return { activeVoiceId: first.id, voiceFingerprint: first.fingerprint }
  }
  const legacy = (settings.voiceFingerprint ?? '').trim()
  if (!legacy) return null
  const profile = makeVoiceProfile(DEFAULT_VOICE_NAME, legacy)
  return { voiceProfiles: [profile], activeVoiceId: profile.id, voiceFingerprint: legacy }
}

/** The profile a document is written in, or the project default. */
export function voiceProfileFor(project: Project, docId?: ID | null): VoiceProfile | null {
  const profiles = project.settings.voiceProfiles ?? []
  if (profiles.length === 0) return null
  const own = docId ? project.nodes[docId]?.meta.voiceId : undefined
  return (own ? profiles.find((p) => p.id === own) : undefined)
    ?? profiles.find((p) => p.id === project.settings.activeVoiceId)
    ?? profiles[0]
    ?? null
}

/**
 * The fingerprint text in force for a document — the one read path.
 *
 * Falls back to the legacy single-string field so a project that hasn't been
 * migrated yet (or was written by an older build) still has a voice.
 */
export function resolveVoice(project: Project | null | undefined, docId?: ID | null): string {
  if (!project) return ''
  const profile = voiceProfileFor(project, docId)
  if (profile) return profile.fingerprint
  return (project.settings.voiceFingerprint as string | undefined) ?? ''
}

/**
 * Pick which job this is: analyse prose that exists, or author a voice from a
 * description.
 *
 * Prose wins when there is any — a fingerprint derived from what the author
 * actually writes beats one derived from what they said they wanted. Returns
 * null when there is neither, so the caller can say so instead of sending an
 * empty prompt.
 */
export function voiceSourceFor(input: { samples?: string; brief?: string; reference?: string }): VoiceSource | null {
  const samples = (input.samples ?? '').trim()
  if (samples) return { from: 'samples', samples }
  const brief = (input.brief ?? '').trim()
  if (brief) return { from: 'brief', brief, reference: (input.reference ?? '').trim() }
  return null
}

/**
 * The compiled prose a fingerprint should be derived from.
 *
 * Only documents marked for compile: notes, outlines and character sheets are
 * the author writing *about* the book, not in its voice, and feeding them in
 * drags the fingerprint toward memo prose.
 */
export function gatherProseSamples(
  project: { nodes: Record<string, { type: string; meta: { includeInCompile: boolean } }>; docs: Record<string, { content?: string }> },
  limit = 6000,
): string {
  let samples = ''
  for (const id of Object.keys(project.docs)) {
    const node = project.nodes[id]
    if (!node || node.type === 'folder' || !node.meta.includeInCompile) continue
    const c = (project.docs[id]?.content ?? '').trim()
    if (!c) continue
    samples += c + '\n\n'
    if (samples.length > limit) break
  }
  return samples.slice(0, limit)
}

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
