// The parsers stand between a model's output and the author's manuscript, so
// they are the part of adventure mode that must never throw and never invent.
// Everything here is a shape a real model has returned for a "give me JSON"
// prompt: fenced, prefaced, half-finished, or quietly the wrong type.

import { describe, it, expect } from 'vitest'
import { wordCount } from '@shared/utils'
import type { Project } from '@shared/types'
import {
  parseOptions,
  parseNotes,
  unseenCandidates,
  precedingText,
  appendPassage,
  spineLine,
  continueCandidates,
  defaultContinueTarget,
  MAX_OPTIONS,
  parseIntent,
  recordTurn,
  settleTurn,
  lastPassageRange,
  TURN_HISTORY_LIMIT,
  type AdventureTurn,
} from './adventure'
import type { CodexEntry } from '@shared/types'

const codexEntry = (name: string, aliases: string[] = []): CodexEntry => ({
  id: name, name, aliases, category: 'character', summary: '', facts: [],
  createdAt: '', modifiedAt: '', aiGenerated: false,
})

describe('parseOptions', () => {
  it('reads the deck the prompt asks for', () => {
    const raw = '[{"text":"She lies about the letter","endScene":false},{"text":"The ferryman returns early","endScene":false}]'
    expect(parseOptions(raw)).toEqual([
      { text: 'She lies about the letter' },
      { text: 'The ferryman returns early' },
    ])
  })

  it('finds the array inside a fence and a preamble', () => {
    const raw = 'Sure! Here are three directions:\n\n```json\n[{"text":"He burns it"}]\n```\n\nHope that helps.'
    expect(parseOptions(raw)).toEqual([{ text: 'He burns it' }])
  })

  it('accepts a bare array of strings', () => {
    // Smaller models frequently ignore the object shape and just list them.
    expect(parseOptions('["He burns it","She leaves"]')).toEqual([
      { text: 'He burns it' },
      { text: 'She leaves' },
    ])
  })

  it('keeps the scene-end flag only when it is actually set', () => {
    const raw = '[{"text":"They part at the dock","endScene":true},{"text":"She follows him","endScene":false}]'
    expect(parseOptions(raw)).toEqual([
      { text: 'They part at the dock', endScene: true },
      { text: 'She follows him' },
    ])
  })

  it('treats a stringy "true" as not set, rather than guessing', () => {
    expect(parseOptions('[{"text":"They part","endScene":"true"}]')).toEqual([{ text: 'They part' }])
  })

  it('drops duplicates — two identical cards are not a choice', () => {
    const raw = '[{"text":"She lies"},{"text":"she lies"},{"text":"He knows"}]'
    expect(parseOptions(raw)).toEqual([{ text: 'She lies' }, { text: 'He knows' }])
  })

  it('drops blanks and non-strings instead of rendering empty cards', () => {
    expect(parseOptions('[{"text":"  "},{"text":42},{"text":"Real one"},null]')).toEqual([{ text: 'Real one' }])
  })

  it('caps the deck so a runaway response cannot flood the UI', () => {
    const raw = JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ text: `beat ${i}` })))
    expect(parseOptions(raw)).toHaveLength(MAX_OPTIONS)
  })

  it('returns nothing for truncated, empty, or non-JSON output', () => {
    expect(parseOptions('[{"text":"She li')).toEqual([])
    expect(parseOptions('')).toEqual([])
    expect(parseOptions('I could not think of any.')).toEqual([])
    expect(parseOptions('{"text":"not an array"}')).toEqual([])
  })
})

describe('parseNotes', () => {
  it('reads candidates and normalises their parts', () => {
    const raw = `[{"name":"The ferryman","category":"character","aliases":["Old Vass"],"summary":"Ferries the dead.","facts":[{"label":"role","value":"ferryman"}]}]`
    expect(parseNotes(raw)).toEqual([{
      name: 'The ferryman',
      category: 'character',
      aliases: ['Old Vass'],
      summary: 'Ferries the dead.',
      facts: [{ label: 'role', value: 'ferryman' }],
    }])
  })

  it('falls back to `character` for an unknown category rather than dropping the entry', () => {
    expect(parseNotes('[{"name":"The Compact","category":"faction"}]')[0]?.category).toBe('character')
  })

  it('never files something unnamed', () => {
    expect(parseNotes('[{"category":"location","summary":"a place"},{"name":"  "}]')).toEqual([])
  })

  it('drops half-written facts instead of storing an empty value', () => {
    const parsed = parseNotes('[{"name":"Mira","facts":[{"label":"age"},{"label":"eyes","value":"grey"},{"value":"orphan"}]}]')
    expect(parsed[0]?.facts).toEqual([{ label: 'eyes', value: 'grey' }])
  })

  it('tolerates the wrong type where a list was asked for', () => {
    const parsed = parseNotes('[{"name":"Mira","aliases":"none","facts":"unknown"}]')
    expect(parsed[0]).toMatchObject({ name: 'Mira', aliases: [], facts: [] })
  })

  it('returns nothing for the empty answer, which is the common one', () => {
    expect(parseNotes('[]')).toEqual([])
    expect(parseNotes('Nothing new in this passage.')).toEqual([])
  })
})

describe('unseenCandidates', () => {
  const found = [
    { name: 'Mira', category: 'character' as const, aliases: [], summary: '', facts: [] },
    { name: 'The Ferryman', category: 'character' as const, aliases: ['Vass'], summary: '', facts: [] },
  ]

  it('hides what the codex already holds, case-insensitively', () => {
    expect(unseenCandidates(found, [codexEntry('mira')]).map((c) => c.name)).toEqual(['The Ferryman'])
  })

  it('matches against existing aliases too', () => {
    expect(unseenCandidates(found, [codexEntry('Old Man', ['the ferryman'])]).map((c) => c.name)).toEqual(['Mira'])
  })

  it('does not treat a near-miss as a match — a new entry is better than a lost one', () => {
    // "ferryman" is not "The Ferryman". The prompt asks the model to skip close
    // matches; guessing at them here would hide entities the story just added.
    expect(unseenCandidates(found, [codexEntry('Old Man', ['ferryman'])]).map((c) => c.name)).toEqual(['Mira', 'The Ferryman'])
  })

  it('matches when the candidate is known under one of its own aliases', () => {
    expect(unseenCandidates(found, [codexEntry('Vass')]).map((c) => c.name)).toEqual(['Mira'])
  })

  it('passes everything through when the codex is empty', () => {
    expect(unseenCandidates(found, [])).toHaveLength(2)
  })
})

describe('precedingText', () => {
  it('returns a short scene whole', () => {
    expect(precedingText('Two lines.\n\nAnd a second.')).toBe('Two lines.\n\nAnd a second.')
  })

  it('keeps the END of a long scene — continuation needs the tail, not the head', () => {
    const long = 'START' + 'x'.repeat(500) + '\n\nfinal paragraph.'
    const out = precedingText(long, 100)
    expect(out).toBe('final paragraph.')
    expect(out).not.toContain('START')
  })

  it('falls back to a raw slice when the tail has no paragraph break', () => {
    const out = precedingText('y'.repeat(300), 50)
    expect(out).toHaveLength(50)
  })

  it('drops trailing whitespace so the model does not continue a blank line', () => {
    expect(precedingText('He waited.\n\n\n')).toBe('He waited.')
  })
})

describe('appendPassage', () => {
  it('separates the new passage with one blank line', () => {
    expect(appendPassage('First.', 'Second.')).toBe('First.\n\nSecond.')
  })

  it('does not open a scene with a blank line', () => {
    expect(appendPassage('', 'Opening.')).toBe('Opening.')
  })

  it('normalises whatever trailing whitespace the document had', () => {
    expect(appendPassage('First.\n\n\n', '  Second.  ')).toBe('First.\n\nSecond.')
  })

  it('leaves the document untouched when the model returned nothing', () => {
    expect(appendPassage('First.', '   ')).toBe('First.')
  })
})

describe('spineLine', () => {
  const beat = { text: 'She lies about the letter', sceneId: 's1', at: '' }

  it('adds a heading when the beat opens a new scene', () => {
    expect(spineLine(beat, 'Scene 2', true)).toBe('\n## Scene 2\n\n- She lies about the letter\n')
  })

  it('is one line inside a scene, so the spine only ever grows', () => {
    expect(spineLine(beat, 'Scene 2', false)).toBe('- She lies about the letter\n')
  })
})

describe('counting words', () => {
  it('counts the way the rest of the app counts', () => {
    // Adventure used to carry its own counter, so the setup screen said 32 for
    // a document the binder called 33 — and the scene-break threshold was
    // measured in a unit the author was never shown. One counter now.
    expect(wordCount('  one   two\nthree ')).toBe(3)
    expect(wordCount('   ')).toBe(0)
  })

  it('ignores Markdown syntax, so a heading is not a word', () => {
    expect(wordCount('# Reiko Tanaka')).toBe(wordCount('Reiko Tanaka'))
    expect(wordCount('**Age** 22')).toBe(2)
  })
})

// ── The conversation ─────────────────────────────────────────────────────────

describe('parseIntent', () => {
  it('reads the JSON the prompt asks for', () => {
    expect(parseIntent('{"intent": "revise"}')).toBe('revise')
    expect(parseIntent('{"intent": "ask"}')).toBe('ask')
    expect(parseIntent('{"intent": "continue"}')).toBe('continue')
  })

  it('digs the object out of a fence or a preamble', () => {
    expect(parseIntent('Sure! ```json\n{"intent":"revise"}\n```')).toBe('revise')
  })

  it('accepts a bare word from a model that ignored the format', () => {
    expect(parseIntent('revise')).toBe('revise')
    expect(parseIntent('"ask"')).toBe('ask')
    expect(parseIntent('  Revise.  ')).toBe('revise')
  })

  it('falls back to continuing the story on anything it cannot read', () => {
    // The safe default: appending costs one step back, whereas silently
    // declining to write would look like the feature was broken.
    expect(parseIntent('')).toBe('continue')
    expect(parseIntent('I think they want you to write more')).toBe('continue')
    expect(parseIntent('{"intent": "sideways"}')).toBe('continue')
    expect(parseIntent('{ broken json')).toBe('continue')
  })

  it('never throws, whatever comes back', () => {
    for (const raw of ['', '{}', '[]', 'null', '{"intent":null}', '\u0000']) {
      expect(() => parseIntent(raw)).not.toThrow()
    }
  })
})

const turn = (id: string, patch: Partial<AdventureTurn> = {}): AdventureTurn => ({
  id, at: '2026-01-01T00:00:00.000Z', said: `said ${id}`, intent: 'continue',
  got: '', sceneId: 'sc1', ...patch,
})

describe('recordTurn', () => {
  it('appends in order', () => {
    const out = recordTurn(recordTurn([], turn('a')), turn('b'))
    expect(out.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('drops the oldest once the transcript is full', () => {
    let turns: AdventureTurn[] = []
    for (let i = 0; i < TURN_HISTORY_LIMIT + 5; i++) turns = recordTurn(turns, turn(String(i)))
    expect(turns).toHaveLength(TURN_HISTORY_LIMIT)
    expect(turns[0]!.id).toBe('5')
    expect(turns[turns.length - 1]!.id).toBe(String(TURN_HISTORY_LIMIT + 4))
  })

  it('does not mutate the list it was given', () => {
    const before: AdventureTurn[] = [turn('a')]
    recordTurn(before, turn('b'))
    expect(before).toHaveLength(1)
  })
})

describe('settleTurn', () => {
  it('fills in the answer and clears pending', () => {
    const turns = [turn('a', { pending: true }), turn('b', { pending: true })]
    const out = settleTurn(turns, 'b', { got: 'the prose' })
    expect(out[1]).toMatchObject({ got: 'the prose', pending: false })
    expect(out[0]!.pending).toBe(true)
  })

  it('is a no-op for an id that is gone', () => {
    // A turn can fall off the top of the transcript while its call is in
    // flight; landing the answer must not resurrect it or throw.
    const turns = [turn('a')]
    expect(settleTurn(turns, 'missing', { got: 'x' })).toEqual(turns)
  })
})

describe('lastPassageRange', () => {
  const scene = 'She opened the door.\n\nThe hallway was dark.'

  it('finds the passage at the end of the scene', () => {
    const r = lastPassageRange(scene, 'The hallway was dark.')!
    expect(scene.slice(r.from, r.to)).toBe('The hallway was dark.')
  })

  it('ignores surrounding whitespace on the passage', () => {
    const r = lastPassageRange(scene, '\n\n  The hallway was dark.  ')!
    expect(scene.slice(r.from, r.to)).toBe('The hallway was dark.')
  })

  it('takes the last occurrence when the text repeats', () => {
    const doubled = 'Wait.\n\nWait.'
    expect(lastPassageRange(doubled, 'Wait.')!.from).toBe(7)
  })

  it('declines when the author has edited the passage by hand', () => {
    // The embedded editor is the real editor, so this happens constantly. No
    // range means the caller says so rather than revising the wrong span.
    expect(lastPassageRange('She opened the door.', 'The hallway was dark.')).toBeNull()
  })

  it('declines when there is no passage to point at', () => {
    expect(lastPassageRange(scene, '')).toBeNull()
    expect(lastPassageRange(scene, '   \n ')).toBeNull()
  })
})

// ── Where Adventure starts drafting ──────────────────────────────────────────

/**
 * A project shaped like a real one: a manuscript of scenes, then a Characters
 * folder whose sheets are written *after* them in binder order. That ordering is
 * the whole bug — "the last written document" is the character sheet.
 */
function novel(): Project {
  const node = (id: string, type: 'folder' | 'scene' | 'document', title: string, parentId: string | null, childIds: string[] = []) => ({
    id, type, title, parentId, childIds, expanded: true,
    meta: { label: 'none' as const, status: 'draft' as const, synopsis: '', target: 0, includeInCompile: type !== 'folder', keywords: [] },
    ext: {}, rev: 1, modified: '2026-01-01T00:00:00.000Z',
  })
  const nodes: Record<string, ReturnType<typeof node>> = {}
  const add = (n: ReturnType<typeof node>) => { nodes[n.id] = n }
  add(node('trash', 'folder', 'Trash', null))
  add(node('ms', 'folder', 'Manuscript', null, ['ch1', 'ch2']))
  add(node('ch1', 'folder', 'Chapter 1', 'ms', ['s1', 's2']))
  add(node('s1', 'scene', 'The first customer', 'ch1'))
  add(node('s2', 'scene', 'Aisle Nine', 'ch1'))
  add(node('ch2', 'folder', 'Chapter 2', 'ms', ['s3']))
  add(node('s3', 'scene', 'The Woman in White', 'ch2'))
  add(node('chars', 'folder', 'Characters', null, ['c1']))
  add(node('c1', 'document', 'Reiko Tanaka', 'chars'))
  add(node('binned', 'scene', 'Deleted scene', 'trash'))
  nodes.trash.childIds = ['binned']
  return {
    schemaVersion: 2, id: 'p', title: 'Midnight Aisle', created: '', modified: '',
    rootIds: ['ms', 'chars', 'trash'], trashId: 'trash',
    nodes: nodes as unknown as Project['nodes'],
    docs: {
      s1: { content: 'The first customer came at 11:14.', snapshots: [] },
      s2: { content: 'The store had eight aisles.', snapshots: [] },
      s3: { content: 'She arrived at 3:33.', snapshots: [] },
      c1: { content: '# Reiko Tanaka\n\nTook the graveyard shift.', snapshots: [] },
      binned: { content: 'Cut from chapter two.', snapshots: [] },
    },
    settings: { location: '', template: 'novel' },
  } as unknown as Project
}

describe('continueCandidates', () => {
  it('lists every written document in binder order', () => {
    expect(continueCandidates(novel()).map((c) => c.id)).toEqual(['s1', 's2', 's3', 'c1'])
  })

  it('leaves out documents with nothing in them', () => {
    const p = novel()
    p.docs.s2 = { content: '   \n ', snapshots: [] }
    expect(continueCandidates(p).map((c) => c.id)).not.toContain('s2')
  })

  it('never offers to continue something in the trash', () => {
    expect(continueCandidates(novel()).map((c) => c.id)).not.toContain('binned')
  })

  it('marks scenes apart from notes, so the two can be grouped', () => {
    const byId = Object.fromEntries(continueCandidates(novel()).map((c) => [c.id, c.isScene]))
    expect(byId.s1).toBe(true)
    expect(byId.c1).toBe(false)
  })

  it('counts words the way the binder does', () => {
    // '# Reiko Tanaka' is two words, not three — the heading marker is syntax.
    expect(continueCandidates(novel()).find((c) => c.id === 'c1')!.words).toBe(6)
  })
})

describe('defaultContinueTarget', () => {
  it('does NOT default to a character sheet just because it was written last', () => {
    // The bug this exists to prevent: Adventure drafted the novel into Reiko's
    // biography and filed the story spine under Characters.
    expect(defaultContinueTarget(novel(), null)).toBe('s3')
  })

  it('takes the selected document when one is selected', () => {
    expect(defaultContinueTarget(novel(), 's1')).toBe('s1')
  })

  it('takes the last scene inside a selected folder', () => {
    expect(defaultContinueTarget(novel(), 'ch1')).toBe('s2')
    expect(defaultContinueTarget(novel(), 'ms')).toBe('s3')
  })

  it('honours a deliberately selected character sheet', () => {
    // Preferring scenes is a default, not a rule — the author pointing at a
    // document is a stronger signal than the heuristic.
    expect(defaultContinueTarget(novel(), 'c1')).toBe('c1')
  })

  it('ignores a selection with nothing written in it', () => {
    const p = novel()
    p.nodes.s4 = { ...p.nodes.s1, id: 's4', title: 'Empty' }
    p.docs.s4 = { content: '', snapshots: [] }
    expect(defaultContinueTarget(p, 's4')).toBe('s3')
  })

  it('falls back to a note when the project has no written scenes', () => {
    const p = novel()
    for (const id of ['s1', 's2', 's3']) p.docs[id] = { content: '', snapshots: [] }
    expect(defaultContinueTarget(p, null)).toBe('c1')
  })

  it('has nothing to point at in an empty project', () => {
    const p = novel()
    p.docs = {}
    expect(defaultContinueTarget(p, null)).toBeNull()
  })
})
