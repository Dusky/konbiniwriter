import { EditorView, Decoration, ViewPlugin, ViewUpdate, type DecorationSet } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { Range } from '@codemirror/state'

// ── Live markdown preview (Ulysses / iA-style) ──────────────────────────────
// Hides formatting markers (**, *, `, #, [[ ]]) so prose reads clean, but
// *reveals* every marker on any line that holds a cursor or selection — so
// nothing is ever uneditable and the document text is never changed. Headings
// get line-level size classes; wikilinks render as chips.
//
// Decorations only (no doc edits), all intra-line, so height/word-count/compile
// and the focus-mode + typewriter extensions are unaffected. See extensions.ts.

const hide = Decoration.replace({})
const headingLine = [
  Decoration.line({ class: 'cm-lp-h1' }),
  Decoration.line({ class: 'cm-lp-h2' }),
  Decoration.line({ class: 'cm-lp-h3' }),
]
const chip = Decoration.mark({ class: 'cm-wikilink-chip' })

const wikilinkRE = /\[\[([^\]]+)\]\]/g

// Marker node names whose delimiters we collapse on inactive lines.
const MARKER_NODES = new Set(['HeaderMark', 'EmphasisMark', 'CodeMark', 'LinkMark', 'URL'])

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view
  const doc = state.doc

  // Lines that must stay fully revealed (any cursor/selection touches them).
  const active = new Set<number>()
  for (const r of state.selection.ranges) {
    const first = doc.lineAt(r.from).number
    const last = doc.lineAt(r.to).number
    for (let n = first; n <= last; n++) active.add(n)
  }

  const marks: Range<Decoration>[] = []
  const lines: Range<Decoration>[] = []

  for (const { from, to } of view.visibleRanges) {
    // Heading line sizing + marker hiding via the syntax tree.
    syntaxTree(state).iterate({
      from, to,
      enter: (node) => {
        const m = /^ATXHeading([1-6])$/.exec(node.name)
        if (m) {
          const level = Math.min(3, parseInt(m[1], 10)) - 1
          const line = doc.lineAt(node.from)
          lines.push(headingLine[level].range(line.from))
          return
        }
        if (MARKER_NODES.has(node.name)) {
          const lineNo = doc.lineAt(node.from).number
          if (active.has(lineNo)) return
          // For a heading mark, also swallow the single space after it so the
          // heading text left-aligns like rendered output.
          let end = node.to
          if (node.name === 'HeaderMark' && doc.sliceString(end, end + 1) === ' ') end += 1
          if (end > node.from) marks.push(hide.range(node.from, end))
        }
      },
    })

    // Wikilinks: [[Reiko]] → chip, with the brackets hidden off active lines.
    const text = doc.sliceString(from, to)
    wikilinkRE.lastIndex = 0
    let wm: RegExpExecArray | null
    while ((wm = wikilinkRE.exec(text)) !== null) {
      const start = from + wm.index
      const innerStart = start + 2
      const innerEnd = start + 2 + wm[1].length
      const end = start + wm[0].length
      if (!active.has(doc.lineAt(start).number)) {
        marks.push(hide.range(start, innerStart))
        marks.push(hide.range(innerEnd, end))
      }
      marks.push(chip.range(innerStart, innerEnd))
    }
  }

  // Two unordered passes + point line decorations → let Decoration.set sort.
  return Decoration.set([...lines, ...marks], true)
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = buildDecorations(view) }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) {
        this.decorations = buildDecorations(u.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)
