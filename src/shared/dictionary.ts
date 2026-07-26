// dictionary.ts — the project's own vocabulary, and the names it protects.
//
// Two problems live here, and only one of them is "spellcheck".
//
// The browser's spellchecker cannot be extended from a web page: a page can ask
// for squiggles but cannot add a word to the dictionary behind them. Electron
// can (on the platforms that don't defer to the OS dictionary), and that path is
// wired up where available. But the check that actually matters for fiction is
// one no general spellchecker can do at all: a made-up name is equally unknown
// however you spell it, so "Reiko", "Reico" and "Rieko" are flagged the same —
// which is to say, uselessly.
//
// So the project keeps its own vocabulary — Codex names and aliases, document
// titles, and anything the writer adds — and this module finds *near misses*
// against it. That catches the real failure: a name that drifted one keystroke
// somewhere in chapter nine.
//
// Pure — no DOM, no Node.

import type { Project } from './types'
import type { CodexEntry } from './types'

export interface NameSlip {
  from: number
  to: number
  /** The suspect token as written. */
  word: string
  /** The known name it is one or two keystrokes away from. */
  suggestion: string
}

/** Words are matched case-insensitively; this is the canonical key. */
const key = (w: string): string => w.toLowerCase()

/**
 * Damerau-Levenshtein distance, abandoned once it exceeds `max`.
 *
 * Transpositions count as one edit because the mistake this exists to catch —
 * "Reiko" typed as "Rieko" — is a transposition, and plain Levenshtein scores
 * that the same as two unrelated substitutions.
 */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1

  const prev2 = new Array<number>(b.length + 1)
  let prev = new Array<number>(b.length + 1)
  let cur = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    let rowMin = cur[0]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1)
      }
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    // Every remaining row can only grow, so this is a safe early exit.
    if (rowMin > max) return max + 1
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j]
    const swap = prev; prev = cur; cur = swap
  }
  return prev[b.length]
}

/**
 * Every name the project considers spelled-correctly: Codex entries and their
 * aliases, document titles, and the writer's own additions.
 *
 * Titles are included because a scene called "Graveyard Shift" makes those words
 * project vocabulary whether or not anyone wrote a Codex entry for them.
 */
export function buildVocabulary(
  project: Project | null,
  codex: CodexEntry[] = [],
  custom: string[] = [],
): string[] {
  const byKey = new Map<string, string>()
  const add = (raw: string) => {
    for (const word of raw.split(/[^\p{L}'’-]+/u)) {
      const w = word.replace(/^['’-]+|['’-]+$/g, '')
      if (w.length < 3) continue
      if (!byKey.has(key(w))) byKey.set(key(w), w)
    }
  }
  for (const e of codex) { add(e.name); for (const a of e.aliases) add(a) }
  if (project) for (const n of Object.values(project.nodes)) add(n.title)
  for (const w of custom) add(w)
  return [...byKey.values()]
}

/** Tokens with their offsets. Apostrophes and hyphens stay inside a word. */
function tokenize(text: string): Array<{ word: string; from: number }> {
  const out: Array<{ word: string; from: number }> = []
  const re = /[\p{L}][\p{L}'’-]*/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.push({ word: m[0].replace(/['’-]+$/, ''), from: m.index })
  }
  return out
}

/** True when this token sits at the start of a sentence (so its case proves nothing). */
function atSentenceStart(text: string, from: number): boolean {
  for (let i = from - 1; i >= 0; i--) {
    const c = text[i]
    if (/\s/.test(c)) continue
    if (/["'“‘(\[*_>]/.test(c)) continue   // quotes, brackets, Markdown marks
    return /[.!?:;]/.test(c)
  }
  return true   // start of the document
}

/**
 * Find tokens that look like a misspelling of a name the project knows.
 *
 * A token is only considered if it appears capitalised *mid-sentence* somewhere
 * in this document — that is the signal that it's a proper noun rather than an
 * ordinary word that happened to start a sentence. Without that guard, "The"
 * gets flagged as a typo for a character named "Thea".
 *
 * Anything in the vocabulary is correct by definition, so silencing a false
 * positive forever is one click: add the word.
 */
export function findNameSlips(text: string, vocabulary: string[]): NameSlip[] {
  if (!text || vocabulary.length === 0) return []

  const known = new Set(vocabulary.map(key))
  const tokens = tokenize(text)

  // Pass 1: which unknown tokens behave like proper nouns in this document?
  const properNouns = new Set<string>()
  for (const t of tokens) {
    if (t.word.length < 3) continue
    if (t.word[0] !== t.word[0].toUpperCase() || t.word[0] === t.word[0].toLowerCase()) continue
    if (known.has(key(t.word))) continue
    if (!atSentenceStart(text, t.from)) properNouns.add(key(t.word))
  }
  if (properNouns.size === 0) return []

  // Pass 2: for each, is it a near miss of something the project knows?
  const suggestionFor = new Map<string, string>()
  for (const k of properNouns) {
    let best: string | null = null
    let bestDist = Infinity
    // Short words tolerate one edit; longer ones, two. Otherwise every
    // three-letter name is a "typo" for every other three-letter name.
    const max = k.length <= 5 ? 1 : 2
    for (const v of vocabulary) {
      const d = editDistance(k, key(v), max)
      if (d <= max && d < bestDist) { best = v; bestDist = d; if (d === 1) break }
    }
    if (best) suggestionFor.set(k, best)
  }
  if (suggestionFor.size === 0) return []

  const slips: NameSlip[] = []
  for (const t of tokens) {
    const suggestion = suggestionFor.get(key(t.word))
    if (suggestion) slips.push({ from: t.from, to: t.from + t.word.length, word: t.word, suggestion })
  }
  return slips
}
