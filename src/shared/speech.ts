// speech.ts — turning a Markdown manuscript into something worth listening to.
//
// Reading prose aloud is the highest-yield revision pass there is: the ear
// catches repetition, clatter and a dropped word that the eye has long since
// stopped seeing. Two jobs, both pure and both easy to get subtly wrong:
//
//   • Split into sentences *with offsets into the original text*, so the
//     sentence being spoken can be highlighted where the writer is reading.
//   • Produce speakable text, because a synthesiser handed raw Markdown says
//     "hash hash Chapter One" and "asterisk asterisk cold asterisk asterisk".
//
// Pure — no DOM, no Node.

export interface Sentence {
  /** Offsets into the ORIGINAL text, so the caller can highlight it. */
  from: number
  to: number
  /** The same span, cleaned up for a speech synthesiser. */
  speak: string
}

// Abbreviations whose full stop does not end a sentence. Deliberately short:
// a missed split costs one over-long utterance, while an over-eager one cuts a
// sentence in half mid-breath, which is far more jarring to listen to.
const ABBREVIATIONS = [
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'jr', 'sr', 'vs', 'etc', 'e.g', 'i.e',
  'no', 'fig', 'inc', 'ltd', 'co', 'capt', 'lt', 'sgt', 'gen', 'rev', 'hon',
]

/** Strip Markdown so a synthesiser reads prose instead of punctuation. */
export function speakableText(raw: string): string {
  return raw
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')            // headings
    .replace(/^\s{0,3}>\s?/gm, '')                 // blockquote markers
    .replace(/^\s{0,3}[-*+]\s+/gm, '')             // bullets
    .replace(/^\s{0,3}\d+\.\s+/gm, '')             // numbered list markers
    .replace(/^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/gm, '')  // thematic breaks
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')      // images → alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')       // links → label
    .replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1')   // wikilinks → target
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')         // code spans
    .replace(/(\*\*\*|___)(.+?)\1/g, '$2')         // bold+italic
    .replace(/(\*\*|__)(.+?)\1/g, '$2')            // bold
    .replace(/(\*|_)(.+?)\1/g, '$2')               // italic
    .replace(/~~(.+?)~~/g, '$1')                   // strikethrough
    .replace(/[ \t]+/g, ' ')
    .trim()
}

/** True when the full stop at `end` belongs to an abbreviation, not a sentence. */
function isAbbreviation(text: string, end: number): boolean {
  if (text[end] !== '.') return false
  let start = end
  while (start > 0 && /[\w.]/.test(text[start - 1])) start--
  const word = text.slice(start, end).toLowerCase()
  if (!word) return false
  if (ABBREVIATIONS.includes(word)) return true
  // A single initial — "J. R. R. Tolkien" — is never a sentence end.
  return word.length === 1 && /[a-z]/.test(word)
}

/**
 * Split text into sentences, keeping offsets into the original.
 *
 * Blank lines end a sentence even without punctuation, so a heading or a line
 * of dialogue without a full stop doesn't glue itself to the next paragraph.
 * Spans whose speakable form is empty (a horizontal rule, say) are dropped —
 * there is nothing to say and nothing worth highlighting.
 */
export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = []
  let start = 0

  const push = (from: number, to: number) => {
    // Trim whitespace off the span itself so the highlight hugs the words.
    let a = from
    let b = to
    while (a < b && /\s/.test(text[a])) a++
    while (b > a && /\s/.test(text[b - 1])) b--
    if (a >= b) return
    const speak = speakableText(text.slice(a, b))
    if (speak) out.push({ from: a, to: b, speak })
  }

  for (let i = 0; i < text.length; i++) {
    const c = text[i]

    if (c === '.' || c === '!' || c === '?') {
      if (c === '.' && isAbbreviation(text, i)) continue
      // Absorb trailing terminators, closing quotes and brackets so `?"` and
      // `…!)` stay with the sentence they end.
      let end = i + 1
      while (end < text.length && /[.!?"'”’)\]]/.test(text[end])) end++
      // A terminator must be followed by whitespace or the end of the text;
      // otherwise it's decimal point or mid-word punctuation.
      if (end < text.length && !/\s/.test(text[end])) continue
      push(start, end)
      start = end
      i = end - 1
      continue
    }

    // A blank line is a hard break regardless of punctuation.
    if (c === '\n' && /^[ \t]*\n/.test(text.slice(i + 1))) {
      push(start, i)
      let end = i
      while (end < text.length && /\s/.test(text[end])) end++
      start = end
      i = end - 1
    }
  }
  push(start, text.length)
  return out
}

/** The index of the sentence containing `pos` — where "play from here" starts. */
export function sentenceIndexAt(sentences: Sentence[], pos: number): number {
  for (let i = 0; i < sentences.length; i++) {
    if (pos <= sentences[i].to) return i
  }
  return Math.max(0, sentences.length - 1)
}
