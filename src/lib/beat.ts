// beat.ts — inline "generate the next beat" seam.
//
// The BeatBox popover invokes streamBeat to draft new prose from a short
// description + length/style presets, streaming it for preview. The result is
// inserted at the cursor as a `selection`-scoped proposal with an empty original
// (a degenerate replace = an insert), so it still flows through the changeset
// review + snapshot pipeline — AI never writes the doc directly (invariant #2).

import type { Project } from '@shared/types'
import type { MentionIndex } from './MentionIndex'
import { promptRegistry } from './PromptRegistry'
import { buildContext, renderContext } from './ContextBuilder'
import { composeCustomInstructions } from './CustomInstructions'
import { streamCompletion } from './AIClient'

export type BeatLength = 'line' | 'paragraph' | 'few' | 'scene'

export const BEAT_LENGTHS: { id: BeatLength; label: string; phrase: string; maxTokens: number }[] = [
  { id: 'line',      label: 'A line',            phrase: 'a single vivid sentence',                         maxTokens: 300 },
  { id: 'paragraph', label: 'A paragraph',       phrase: 'one focused paragraph',                            maxTokens: 700 },
  { id: 'few',       label: 'A few paragraphs',  phrase: 'two or three paragraphs',                          maxTokens: 1400 },
  { id: 'scene',     label: 'A full scene',      phrase: 'a complete short scene, roughly 500–800 words',    maxTokens: 2600 },
]

export const BEAT_STYLES: { id: string; label: string; phrase: string }[] = [
  { id: 'voice',    label: 'Match manuscript voice', phrase: 'Match the established narrative voice, tense, and register of the manuscript.' },
  { id: 'terse',    label: 'Terse',                  phrase: 'Terse and spare — short sentences, understated, no filler.' },
  { id: 'lyrical',  label: 'Lyrical',                phrase: 'Lyrical and image-rich, with rhythm and concrete sensory detail.' },
  { id: 'action',   label: 'Action',                 phrase: 'Kinetic and fast — concrete verbs, momentum, minimal interiority.' },
  { id: 'dialogue', label: 'Dialogue-heavy',         phrase: 'Mostly dialogue, with light action beats and subtext.' },
]

export function beatLength(id: BeatLength) { return BEAT_LENGTHS.find((l) => l.id === id) ?? BEAT_LENGTHS[1] }
export function beatStylePhrase(id: string, freeText: string): string {
  const preset = BEAT_STYLES.find((s) => s.id === id)?.phrase ?? ''
  return [preset, freeText.trim()].filter(Boolean).join(' ')
}

export const BEAT_PROMPT_ID = 'builtin:generate:beat'

export function streamBeat(opts: {
  project: Project
  mentionIndex: MentionIndex
  docId: string
  preceding: string
  description: string
  length: BeatLength
  styleId: string
  styleText: string
  model?: string
  signal?: AbortSignal
  onChunk?: (partial: string) => void
}): Promise<string> {
  const { project, mentionIndex, docId, preceding, description, length, styleId, styleText, model, signal, onChunk } = opts
  const template = promptRegistry.get(BEAT_PROMPT_ID)
  if (!template) return Promise.reject(new Error(`Missing prompt template: ${BEAT_PROMPT_ID}`))

  const len = beatLength(length)
  const ctxPacket = buildContext(project, mentionIndex, docId, 'inline')
  const contextStr = renderContext(ctxPacket)
  const rendered = promptRegistry.render(BEAT_PROMPT_ID, {
    context: contextStr,
    preceding: preceding.trim() || '(start of scene)',
    description: description.trim(),
    length: len.phrase,
    style: beatStylePhrase(styleId, styleText) || 'Match the manuscript voice.',
  })

  let partial = ''
  return new Promise<string>((resolve, reject) => {
    if (signal) signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    streamCompletion(
      [{ role: 'user', content: rendered }],
      { model: model || template.model, maxTokens: len.maxTokens, temperature: template.temperature, systemPrompt: composeCustomInstructions() || undefined, signal },
      {
        onChunk: (c) => { partial += c; onChunk?.(partial) },
        onDone: resolve,
        onError: reject,
      },
    ).catch(reject)
  })
}
