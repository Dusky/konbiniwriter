// footnotes.ts — Markdown footnotes, in and out.
//
// The syntax is the ordinary one (`[^1]` in the prose, `[^1]: the note` on its
// own line), which matters because a `.konbini` bundle is plain Markdown a
// writer can open in any editor. A footnote has to survive being read by
// something that has never heard of Konbini.
//
// One parser, four consumers: the Scrivener importer writes this syntax, and
// the DOCX, EPUB and Markdown exports read it. Before this existed the
// importer simply discarded footnotes, which is the worst of the options.
//
// Pure — no DOM, no Node.

export interface Footnote {
  /** The label as written, e.g. `1` or `mira-age`. */
  label: string
  text: string
}

export interface FootnoteSplit {
  /** The prose, with definition lines removed but `[^label]` references intact. */
  body: string
  /** Notes in the order their references first appear in the body. */
  notes: Footnote[]
}

/** A reference like `[^1]`, not preceded by a backslash. */
const REF = /\[\^([^\]\s]+)\]/g
/** A definition line: `[^1]: text`, with optional indented continuation lines. */
const DEF = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/

/**
 * Pull the definitions out of a Markdown document.
 *
 * Ordering follows the *references*, not the definitions, because that is the
 * order a reader meets them — a document whose definitions are alphabetised
 * should still number 1, 2, 3 down the page. A definition nothing refers to is
 * kept at the end rather than dropped; it is text the author wrote.
 */
export function splitFootnotes(markdown: string): FootnoteSplit {
  const defs = new Map<string, string>()
  const kept: string[] = []
  let current: string | null = null

  for (const raw of markdown.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const m = DEF.exec(line)
    if (m) {
      current = m[1] as string
      defs.set(current, (m[2] ?? '').trim())
      continue
    }
    // An indented line directly under a definition continues it.
    if (current && /^[ \t]+\S/.test(line)) {
      defs.set(current, `${defs.get(current) ?? ''} ${line.trim()}`.trim())
      continue
    }
    current = null
    kept.push(line)
  }

  const notes: Footnote[] = []
  const seen = new Set<string>()
  const body = kept.join('\n')
  REF.lastIndex = 0
  let r: RegExpExecArray | null
  while ((r = REF.exec(body)) !== null) {
    const label = r[1] as string
    if (seen.has(label) || !defs.has(label)) continue
    seen.add(label)
    notes.push({ label, text: defs.get(label) as string })
  }
  // Definitions with no reference: keep them, at the end, rather than lose them.
  for (const [label, text] of defs) if (!seen.has(label)) notes.push({ label, text })

  return { body: body.replace(/\n{3,}/g, '\n\n').trim(), notes }
}

/** Segments of one line: prose runs and the footnote references between them. */
export type NoteSegment = { text: string } | { ref: string; index: number }

/**
 * Split a line into prose and references, numbered by `order`.
 *
 * `order` is the labels in final document order, so a reference renders as the
 * number a reader will see even when the author labelled it `mira-age`.
 */
export function segmentLine(line: string, order: string[]): NoteSegment[] {
  const out: NoteSegment[] = []
  let last = 0
  REF.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = REF.exec(line)) !== null) {
    const idx = order.indexOf(m[1] as string)
    // A reference with no definition is just text — don't invent a note for it.
    if (idx === -1) continue
    if (m.index > last) out.push({ text: line.slice(last, m.index) })
    out.push({ ref: m[1] as string, index: idx + 1 })
    last = m.index + m[0].length
  }
  if (last < line.length) out.push({ text: line.slice(last) })
  return out
}

/** Render notes back into Markdown definition lines. */
export function renderFootnotes(notes: Footnote[]): string {
  return notes.map((n) => `[^${n.label}]: ${n.text}`).join('\n')
}

/** True when the text carries at least one usable footnote. */
export const hasFootnotes = (markdown: string): boolean => splitFootnotes(markdown).notes.length > 0
