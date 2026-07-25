// rtf.ts — just enough RTF to recover prose.
//
// Scrivener stores every document as RTF. We don't need a real RTF renderer:
// we need the words, the paragraph breaks, and the italics/bold a novelist
// actually used. Everything else (fonts, colour tables, style sheets, embedded
// objects) is discarded on purpose.
//
// Pure — no DOM, no Node.

/** Control-word groups whose *content* is metadata, not prose. */
const SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'themedata',
  'colorschememapping', 'latentstyles', 'datastore', 'generator', 'listtable',
  'listoverridetable', 'rsidtbl', 'xmlnstbl', 'filetbl', 'revtbl', 'upr',
  'header', 'footer', 'footnote', 'annotation', 'bkmkstart', 'bkmkend',
])

interface Ctx { skip: boolean; bold: boolean; italic: boolean }

/**
 * Convert RTF to Markdown-ish plain text.
 *
 * Paragraphs become blank-line-separated blocks; `\b` / `\i` runs become
 * `**bold**` / `*italic*` so a Scrivener manuscript keeps its emphasis instead
 * of arriving as flat text.
 */
export function rtfToText(rtf: string): string {
  if (!rtf.includes('\\rtf')) return rtf.trim()   // not RTF; pass through

  let out = ''
  let i = 0
  const stack: Ctx[] = []
  let ctx: Ctx = { skip: false, bold: false, italic: false }

  // Track where each open delimiter *ends* in `out`. If the run turns out to be
  // empty we rewind and drop the opener rather than emitting `****`. Cleaning up
  // afterwards with a regex is not an option: an empty `*…*` pair is textually
  // identical to a bold `**`, so any such pass eats real formatting.
  let boldOpenAt = -1
  let italicOpenAt = -1

  const emit = (s: string) => { if (!ctx.skip) out += s }
  const closeEmphasis = () => {
    if (italicOpenAt >= 0) {
      if (out.length === italicOpenAt) out = out.slice(0, italicOpenAt - 1)
      else out += '*'
      italicOpenAt = -1
    }
    if (boldOpenAt >= 0) {
      if (out.length === boldOpenAt) out = out.slice(0, boldOpenAt - 2)
      else out += '**'
      boldOpenAt = -1
    }
  }
  const syncEmphasis = () => {
    if (ctx.skip) return
    if (!ctx.italic && italicOpenAt >= 0) {
      if (out.length === italicOpenAt) out = out.slice(0, italicOpenAt - 1)
      else out += '*'
      italicOpenAt = -1
    }
    if (!ctx.bold && boldOpenAt >= 0) {
      if (out.length === boldOpenAt) out = out.slice(0, boldOpenAt - 2)
      else out += '**'
      boldOpenAt = -1
    }
    if (ctx.bold && boldOpenAt < 0) { out += '**'; boldOpenAt = out.length }
    if (ctx.italic && italicOpenAt < 0) { out += '*'; italicOpenAt = out.length }
  }

  while (i < rtf.length) {
    const ch = rtf[i]

    if (ch === '{') {
      stack.push({ ...ctx })
      i++
      continue
    }
    if (ch === '}') {
      closeEmphasis()
      ctx = stack.pop() ?? { skip: false, bold: false, italic: false }
      i++
      continue
    }

    if (ch === '\\') {
      // Escaped literal characters.
      const next = rtf[i + 1]
      if (next === '\\' || next === '{' || next === '}') { syncEmphasis(); emit(next); i += 2; continue }
      if (next === '~') { syncEmphasis(); emit(' '); i += 2; continue }
      if (next === '\n' || next === '\r') { emit('\n\n'); i += 2; continue }

      // Control word: \word[-][digits][ ]
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i))
      if (!m) { i++; continue }
      const word = m[1]
      const param = m[2] !== undefined ? parseInt(m[2], 10) : undefined
      i += m[0].length

      if (word === 'u' && param !== undefined) {
        // \uN with a following replacement char to skip.
        syncEmphasis()
        emit(String.fromCharCode(param < 0 ? param + 65536 : param))
        if (rtf[i] === '?') i++
        continue
      }
      if (SKIP_DESTINATIONS.has(word)) { ctx.skip = true; continue }
      switch (word) {
        case 'par': case 'pard': closeEmphasis(); emit('\n\n'); break
        case 'line': closeEmphasis(); emit('\n'); break
        case 'tab': emit('\t'); break
        case 'emdash': emit('—'); break
        case 'endash': emit('–'); break
        case 'lquote': emit('‘'); break
        case 'rquote': emit('’'); break
        case 'ldblquote': emit('“'); break
        case 'rdblquote': emit('”'); break
        case 'bullet': emit('•'); break
        case 'b': ctx.bold = param !== 0; break
        case 'i': ctx.italic = param !== 0; break
        case 'plain': ctx.bold = false; ctx.italic = false; break
        default: break   // every other control word is formatting we don't keep
      }
      continue
    }

    if (ch === '\n' || ch === '\r') { i++; continue }   // raw newlines aren't breaks in RTF
    syncEmphasis()
    emit(ch)
    i++
  }
  closeEmphasis()

  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
