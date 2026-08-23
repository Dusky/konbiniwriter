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

const OPENING_PROMPT_ID = 'builtin:adventure:opening'
const PASSAGE_PROMPT_ID = 'builtin:adventure:passage'
const OPTIONS_PROMPT_ID = 'builtin:adventure:options'
const NOTES_PROMPT_ID = 'builtin:adventure:notes'
const SUMMARY_PROMPT_ID = 'builtin:adventure:summary'
const INTENT_PROMPT_ID = 'builtin:adventure:intent'
const REVISE_PROMPT_ID = 'builtin:adventure:revise'
const CONTINUE_PROMPT_ID = 'builtin:adventure:continue'
const ANSWER_PROMPT_ID = 'builtin:adventure:answer'

/** How much of the current scene to show the model as "what just happened". */
const PRECEDING_LIMIT = 4000
/** Ceiling on the rolling summary, in words. Past this it stops being cheap. */
const SUMMARY_WORD_LIMIT = 350
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
 * What the author meant by a line they typed.
 *
 * The deck's cards are unambiguously beats, so only free text is classified.
 * Every outcome is cheap to be wrong about, which is what makes guessing
 * acceptable at all: a `continue` appends and costs one step back, a `revise`
 * arrives as a changeset the author can reject, and an `ask` writes nothing.
 */
export type Intent = 'continue' | 'revise' | 'ask'

/** One exchange in the session — what the author said, and what came back. */
export interface AdventureTurn {
  id: string
  at: ISO
  /** Verbatim, so the transcript is a record of intent and not of beats. */
  said: string
  intent: Intent
  /** Prose for `continue`, the revised passage for `revise`, the reply for `ask`. */
  got: string
  /** True while the model is still answering this turn. */
  pending?: boolean
  /** A revision that went out as a changeset rather than straight to the page. */
  proposed?: boolean
  sceneId: ID
}

/**
 * How many turns the session file keeps.
 *
 * The transcript is a convenience, not an archive: the prose lives in the
 * manuscript and the decisions live in the spine document, so old turns can
 * fall off the top without losing anything the author would miss. Keeping them
 * all would duplicate the whole book inside `aux/adventure.json`.
 */
export const TURN_HISTORY_LIMIT = 40

/** Append a turn, dropping the oldest once the transcript is full. */
export function recordTurn(turns: AdventureTurn[], turn: AdventureTurn): AdventureTurn[] {
  const next = [...turns, turn]
  return next.length > TURN_HISTORY_LIMIT ? next.slice(-TURN_HISTORY_LIMIT) : next
}

/** Replace a turn in place — used when a pending turn's answer lands. */
export function settleTurn(turns: AdventureTurn[], id: string, patch: Partial<AdventureTurn>): AdventureTurn[] {
  return turns.map((t) => (t.id === id ? { ...t, ...patch, pending: false } : t))
}

/**
 * Where the last passage sits in the scene, so a revision can replace exactly
 * that span and nothing else.
 *
 * Found by searching for the text rather than by offset arithmetic, because the
 * author can edit the scene between turns — the embedded editor is the real
 * editor. If the passage is no longer there verbatim, the answer is null and
 * the caller declines to revise rather than guessing at a range.
 */
export function lastPassageRange(content: string, passage: string): { from: number; to: number } | null {
  const body = passage.trim()
  if (!body) return null
  const at = content.lastIndexOf(body)
  return at === -1 ? null : { from: at, to: at + body.length }
}

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
  /** The conversation, most recent last. Capped at `TURN_HISTORY_LIMIT`. */
  turns: AdventureTurn[]
  /** Whether the deck of suggested beats is showing. */
  deckOpen: boolean
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
    turns: [],
    deckOpen: true,
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

/**
 * Read the classifier's answer.
 *
 * Defaults to `continue` on anything unrecognised, because that is both the
 * common case and the one the author can undo with a single keystroke. A
 * misread that appends costs a step back; a misread that silently declined to
 * write would look like the feature was broken.
 */
export function parseIntent(raw: string): Intent {
  const match = raw.match(/\{[\s\S]*?\}/)
  if (match) {
    try {
      const value = String((JSON.parse(match[0]) as Record<string, unknown>).intent ?? '').toLowerCase()
      if (value === 'revise' || value === 'ask' || value === 'continue') return value
    } catch { /* fall through to the bare-word read */ }
  }
  // Some models answer with the bare word and no JSON at all.
  const word = raw.trim().toLowerCase()
  if (/^"?revise"?[.\s]*$/.test(word)) return 'revise'
  if (/^"?ask"?[.\s]*$/.test(word)) return 'ask'
  return 'continue'
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

/**
 * Decide whether a line the author typed drives the story forward, asks for a
 * change to what was just written, or is a question about the book.
 *
 * Only free text reaches here — picking a card from the deck is unambiguously a
 * beat and skips the call entirely, so conversing costs one extra round trip
 * and choosing costs none. With nothing written yet there is nothing to revise
 * or ask about, so the classifier is skipped there too.
 */
export async function classifyIntent(args: { said: string; passage: string; signal?: AbortSignal }): Promise<Intent> {
  if (!args.passage.trim()) return 'continue'
  const raw = await run(INTENT_PROMPT_ID, { said: args.said, passage: args.passage }, { signal: args.signal })
  return parseIntent(raw)
}

/**
 * Rewrite the passage just written, to the author's instruction.
 *
 * Returns the revised passage only — the caller sends it through `Proposal` as
 * a `selection`-scoped changeset, because this is the one thing in Adventure
 * that replaces prose rather than adding it.
 */
export function streamRevision(args: SceneArgs & { instruction: string; passage: string }): Promise<string> {
  const { project, index, session, instruction, passage } = args
  const content = project.docs[session.activeSceneId]?.content ?? ''
  const at = content.lastIndexOf(passage.trim())
  return run(REVISE_PROMPT_ID, {
    summary: session.summary || '(the story has only just started)',
    context: sceneContext(project, index, session.activeSceneId),
    preceding: precedingText(at > 0 ? content.slice(0, at) : ''),
    passage,
    instruction,
    style: beatStylePhrase(session.styleId, session.styleText),
  }, args)
}

/**
 * Carry on from wherever the text stops, with no beat.
 *
 * This is the half of co-writing the deck cannot express: the author wrote the
 * last paragraph themselves and wants the pen back, without having to invent a
 * direction to justify it.
 */
export function streamContinuation(args: SceneArgs): Promise<string> {
  const { project, index, session } = args
  const len = beatLength(session.passageLength)
  const content = project.docs[session.activeSceneId]?.content ?? ''
  return run(CONTINUE_PROMPT_ID, {
    summary: session.summary || '(the story has only just started)',
    context: sceneContext(project, index, session.activeSceneId),
    preceding: precedingText(content),
    length: len.phrase,
    style: beatStylePhrase(session.styleId, session.styleText),
  }, args)
}

/** Answer a question about the story. Writes nothing. */
export function answerAside(args: SceneArgs & { question: string }): Promise<string> {
  const { project, index, session, question } = args
  const content = project.docs[session.activeSceneId]?.content ?? ''
  return run(ANSWER_PROMPT_ID, {
    summary: session.summary || '(the story has only just started)',
    context: sceneContext(project, index, session.activeSceneId),
    preceding: precedingText(content),
    question,
  }, args).then((t) => t.trim())
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
