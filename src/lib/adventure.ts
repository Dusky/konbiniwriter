// adventure.ts — the beat-by-beat drafting runner.
//
// The loop: write a passage, offer the author a deck of *beats* (one-line story
// directions, not prose), append the chosen one's prose, repeat. The author
// chooses what happens; the model renders the sentences.
//
// Two things this module is careful about:
//
// 1. It only ever *appends*. Nothing here replaces a word already in a
//    document, which is why the caller can write through `updateContent` after
//    a snapshot instead of routing through the proposal pipeline (invariant 2's
//    actual principle: never alter author text unreviewed). Anything that
//    rewrites existing prose is the caller's job to send through `Proposal`.
// 2. It carries a rolling summary rather than resending the manuscript. A novel
//    is several hundred beats; paying for the whole book on every one of them
//    is what makes this feature unaffordable.
//
// Every prompt comes from the registry (invariant 3). The parsers are pure and
// tolerant — they never throw and never invent a beat the model didn't ask for.

import { promptRegistry } from './PromptRegistry'
import { streamToString } from './AIClient'
import { buildContext, renderContext } from './ContextBuilder'
import { composeCustomInstructions } from './CustomInstructions'
import { beatLength, beatStylePhrase, type BeatLength } from './beat'
import type { MentionIndex } from './MentionIndex'
import type { CodexCategory, CodexEntry, ID, ISO, Project } from '@shared/types'

export const OPENING_PROMPT_ID = 'builtin:adventure:opening'
export const PASSAGE_PROMPT_ID = 'builtin:adventure:passage'
export const OPTIONS_PROMPT_ID = 'builtin:adventure:options'
export const NOTES_PROMPT_ID = 'builtin:adventure:notes'
export const SUMMARY_PROMPT_ID = 'builtin:adventure:summary'

/** How much of the current scene to show the model as "what just happened". */
const PRECEDING_LIMIT = 4000
/** Ceiling on the rolling summary, in words. Past this it stops being cheap. */
export const SUMMARY_WORD_LIMIT = 350
/** How many beats back to send as "don't repeat these". */
const USED_BEATS_WINDOW = 12
/** Deck size bounds. Fewer than two isn't a choice; more than six isn't read. */
export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 6

/** One direction the story could take. */
export interface AdventureOption {
  text: string
  /** The model offering to end the scene here rather than continue it. */
  endScene?: boolean
}

/** A beat the author accepted, in order. The ledger of these is the outline. */
export interface AdventureBeat {
  text: string
  sceneId: ID
  at: ISO
}

/** A codex entry the assistant noticed, before the author has filed it. */
export interface NoteCandidate {
  name: string
  category: CodexCategory
  aliases: string[]
  summary: string
  facts: { label: string; value: string }[]
}

export type OptionDetail = 'terse' | 'detailed'

/**
 * Everything needed to resume a session, persisted to `aux/adventure.json`.
 *
 * Losing this file loses your place, not your book: the prose is in the
 * manuscript and the beat ledger is mirrored into a real binder document.
 */
export interface AdventureSession {
  premise: string
  /** Folder new scenes are created in. */
  targetFolderId: ID
  /** The document passages are appended to right now. */
  activeSceneId: ID
  /** The living outline document, if one has been created. */
  spineId: ID | null
  passageLength: BeatLength
  optionCount: number
  optionDetail: OptionDetail
  styleId: string
  styleText: string
  /** Words the active scene must reach before a scene-end card is offered. */
  sceneBreakAfter: number
  beats: AdventureBeat[]
  summary: string
  /** The deck as it stands, so a reload doesn't cost a generation. */
  options: AdventureOption[]
  startedAt: ISO
}

export function newSession(patch: Partial<AdventureSession> & Pick<AdventureSession, 'targetFolderId' | 'activeSceneId'>): AdventureSession {
  return {
    premise: '',
    spineId: null,
    passageLength: 'paragraph',
    optionCount: 4,
    optionDetail: 'terse',
    styleId: 'voice',
    styleText: '',
    sceneBreakAfter: 600,
    beats: [],
    summary: '',
    options: [],
    startedAt: new Date().toISOString(),
    ...patch,
  }
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/** The first JSON array in a response, ignoring fences and any preamble. */
function jsonArray(raw: string): unknown[] {
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[0])
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * Parse a deck of beats.
 *
 * Tolerant of a bare array of strings, since a smaller model asked for
 * `[{text, endScene}]` will sometimes just return `["…", "…"]`. Duplicates and
 * blanks are dropped — an option the author can't tell apart from another one
 * isn't a choice.
 */
export function parseOptions(raw: string): AdventureOption[] {
  const out: AdventureOption[] = []
  const seen = new Set<string>()
  for (const item of jsonArray(raw)) {
    const text = typeof item === 'string' ? item.trim() : clean((item as Record<string, unknown>)?.text)
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const endScene = typeof item === 'object' && item !== null && (item as Record<string, unknown>).endScene === true
    out.push(endScene ? { text, endScene: true } : { text })
    if (out.length >= MAX_OPTIONS) break
  }
  return out
}

const CATEGORIES: ReadonlySet<string> = new Set(['character', 'location', 'item', 'concept', 'lore'])

/**
 * Parse codex candidates from the note-taking pass.
 *
 * Anything unnamed is dropped rather than filed under a guess, and an
 * unrecognised category falls back to `character` — the same rule CodexPanel's
 * prose scan uses, so both paths agree on what a candidate looks like.
 */
export function parseNotes(raw: string): NoteCandidate[] {
  const out: NoteCandidate[] = []
  const seen = new Set<string>()
  for (const item of jsonArray(raw)) {
    if (typeof item !== 'object' || item === null) continue
    const e = item as Record<string, unknown>
    const name = clean(e.name)
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    const category = clean(e.category)
    out.push({
      name,
      category: (CATEGORIES.has(category) ? category : 'character') as CodexCategory,
      aliases: Array.isArray(e.aliases) ? e.aliases.map(clean).filter(Boolean) : [],
      summary: clean(e.summary),
      facts: Array.isArray(e.facts)
        ? e.facts
            .map((f) => ({ label: clean((f as Record<string, unknown>)?.label), value: clean((f as Record<string, unknown>)?.value) }))
            .filter((f) => f.label && f.value)
        : [],
    })
  }
  return out
}

/** Drop candidates the codex already has, by name or alias. */
export function unseenCandidates(candidates: NoteCandidate[], codex: CodexEntry[]): NoteCandidate[] {
  const known = new Set<string>()
  for (const entry of codex) {
    known.add(entry.name.toLowerCase())
    for (const a of entry.aliases) known.add(a.toLowerCase())
  }
  return candidates.filter((c) => !known.has(c.name.toLowerCase()) && !c.aliases.some((a) => known.has(a.toLowerCase())))
}

// ── Prompt plumbing ──────────────────────────────────────────────────────────

interface RunOpts { signal?: AbortSignal; onChunk?: (soFar: string) => void }

function run(promptId: string, vars: Record<string, string>, opts: RunOpts): Promise<string> {
  const template = promptRegistry.get(promptId)
  if (!template) return Promise.reject(new Error(`Missing prompt template: ${promptId}`))
  const rendered = promptRegistry.render(promptId, vars)
  const instructions = composeCustomInstructions()
  return streamToString(
    [{ role: 'user', content: rendered }],
    {
      model: template.model,
      maxTokens: template.maxTokens,
      temperature: template.temperature,
      systemPrompt: instructions || undefined,
      signal: opts.signal,
    },
    opts.onChunk,
  )
}

/** The tail of a scene — what the model needs to continue mid-paragraph. */
export function precedingText(content: string, limit = PRECEDING_LIMIT): string {
  const trimmed = content.trimEnd()
  if (trimmed.length <= limit) return trimmed
  const slice = trimmed.slice(-limit)
  const brk = slice.indexOf('\n\n')
  return brk === -1 ? slice : slice.slice(brk + 2)
}

function sceneContext(project: Project, index: MentionIndex, sceneId: ID): string {
  return renderContext(buildContext(project, index, sceneId, 'adventure'))
}

const DETAIL_PHRASE: Record<OptionDetail, string> = {
  terse: 'Keep each direction to one short sentence — under twelve words.',
  detailed: 'Give each direction one or two sentences with a concrete, specific detail — twenty to forty words.',
}

export const words = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0)

// ── The four calls ───────────────────────────────────────────────────────────

interface SceneArgs {
  project: Project
  index: MentionIndex
  session: AdventureSession
  signal?: AbortSignal
  onChunk?: (soFar: string) => void
}

/** The first passage, from the premise alone. */
export function streamOpening(args: SceneArgs): Promise<string> {
  const { project, index, session } = args
  const len = beatLength(session.passageLength)
  return run(OPENING_PROMPT_ID, {
    premise: session.premise,
    context: sceneContext(project, index, session.activeSceneId),
    length: len.phrase,
    style: beatStylePhrase(session.styleId, session.styleText),
  }, args)
}

/** Render one chosen beat as prose, continuing the active scene. */
export function streamPassage(args: SceneArgs & { beat: string }): Promise<string> {
  const { project, index, session, beat } = args
  const len = beatLength(session.passageLength)
  const content = project.docs[session.activeSceneId]?.content ?? ''
  return run(PASSAGE_PROMPT_ID, {
    summary: session.summary || '(the story has only just started)',
    context: sceneContext(project, index, session.activeSceneId),
    preceding: precedingText(content),
    beat,
    length: len.phrase,
    style: beatStylePhrase(session.styleId, session.styleText),
  }, args)
}

/**
 * A fresh deck of beats.
 *
 * The scene-end card is only offered once the scene has earned it. Without the
 * word gate the model proposes a curtain every third beat and the binder fills
 * with hundred-word scenes.
 */
export async function generateOptions(args: SceneArgs): Promise<AdventureOption[]> {
  const { project, session } = args
  const content = project.docs[session.activeSceneId]?.content ?? ''
  const longEnough = words(content) >= session.sceneBreakAfter
  const raw = await run(OPTIONS_PROMPT_ID, {
    summary: session.summary || '(the story has only just started)',
    preceding: precedingText(content),
    used: session.beats.slice(-USED_BEATS_WINDOW).map((b) => `- ${b.text}`).join('\n') || '(none yet)',
    count: String(Math.max(MIN_OPTIONS, Math.min(MAX_OPTIONS, session.optionCount))),
    detail: DETAIL_PHRASE[session.optionDetail],
    scene_break: longEnough
      ? '- This scene has run long enough to close. If it has reached a natural resting point, make ONE option a scene ending: set "endScene": true and say what note it ends on. Only if it genuinely fits.'
      : '- This scene is still young. Do not offer to end it — every option must continue it.',
  }, args)
  const parsed = parseOptions(raw)
  return longEnough ? parsed : parsed.map(({ text }) => ({ text }))
}

/** What the passage introduced that the codex doesn't know yet. */
export async function takeNotes(args: { project: Project; passage: string; signal?: AbortSignal }): Promise<NoteCandidate[]> {
  const codex = (args.project.settings.codex as CodexEntry[] | undefined) ?? []
  const raw = await run(NOTES_PROMPT_ID, {
    existing: codex.map((e) => e.name).join(', ') || 'none',
    passage: args.passage,
  }, { signal: args.signal })
  return unseenCandidates(parseNotes(raw), codex)
}

/** Fold the new passage into the rolling summary. */
export function updateSummary(args: { summary: string; passage: string; signal?: AbortSignal }): Promise<string> {
  return run(SUMMARY_PROMPT_ID, {
    summary: args.summary || '(nothing yet — this is the opening)',
    passage: args.passage,
    limit: String(SUMMARY_WORD_LIMIT),
  }, { signal: args.signal }).then((s) => s.trim())
}

// ── The living outline ───────────────────────────────────────────────────────

export const SPINE_TITLE = 'Story spine'

/**
 * The line a beat contributes to the spine document.
 *
 * Append-only by construction: each accepted beat adds one line under its
 * scene's heading, so the spine is a record of decisions rather than something
 * regenerated (and therefore never overwrites an author's own edits to it).
 */
export function spineLine(beat: AdventureBeat, sceneTitle: string, isNewScene: boolean): string {
  const head = isNewScene ? `\n## ${sceneTitle}\n\n` : ''
  return `${head}- ${beat.text}\n`
}

/** Join a new passage onto a scene. The one place the shape of an append lives. */
export function appendPassage(existing: string, passage: string): string {
  const body = passage.trim()
  if (!body) return existing
  const head = existing.trimEnd()
  return head ? `${head}\n\n${body}` : body
}
