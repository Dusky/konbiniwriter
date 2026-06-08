import { EditorView, Decoration, ViewPlugin, ViewUpdate } from '@codemirror/view'
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { defaultKeymap, historyKeymap, history, indentWithTab } from '@codemirror/commands'
import { keymap } from '@codemirror/view'
import { search, searchKeymap } from '@codemirror/search'
import { tags } from '@lezer/highlight'

// ── Markdown highlight style — maps lezer tags → CSS classes ─────────────────
export const markdownHighlight = HighlightStyle.define([
  { tag: [tags.heading1],              class: 'cm-h1 cm-h' },
  { tag: [tags.heading2],              class: 'cm-h2 cm-h' },
  { tag: [tags.heading3],              class: 'cm-h3 cm-h' },
  { tag: tags.emphasis,                class: 'cm-em' },
  { tag: tags.strong,                  class: 'cm-strong' },
  { tag: tags.quote,                   class: 'cm-quote' },
  { tag: tags.url,                     class: 'cm-link' },
  { tag: tags.link,                    class: 'cm-link' },
  { tag: tags.monospace,               class: 'cm-code' },
  { tag: tags.processingInstruction,   class: 'cm-mk' },
  { tag: tags.contentSeparator,        class: 'cm-mk' },
  { tag: tags.labelName,               class: 'cm-link' },
  { tag: tags.list,                    class: 'cm-bul' },
  { tag: tags.meta,                    class: 'cm-mk' },
  { tag: tags.punctuation,             class: 'cm-mk' },
])

// ── Wikilink decoration [[...]] ────────────────────────────────────────────────
const wikilinkRE = /\[\[([^\]]+)\]\]/g

const wikilinkPlugin = ViewPlugin.fromClass(class {
  decorations: ReturnType<typeof Decoration.set>
  constructor(view: EditorView) { this.decorations = this.build(view) }
  update(update: ViewUpdate) { if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view) }
  build(view: EditorView) {
    const builder = new RangeSetBuilder<Decoration>()
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to)
      let m: RegExpExecArray | null
      wikilinkRE.lastIndex = 0
      while ((m = wikilinkRE.exec(text)) !== null) {
        const start = from + m.index
        const end = start + m[0].length
        builder.add(start, end, Decoration.mark({ class: 'cm-wikilink' }))
      }
    }
    return builder.finish()
  }
}, { decorations: (v) => v.decorations })

// ── Focus mode: dim all lines except current paragraph ───────────────────────
export const focusModeEffect = StateEffect.define<boolean>()
export const focusModeField = StateField.define<boolean>({
  create: () => false,
  update(val, tr) {
    for (const e of tr.effects) if (e.is(focusModeEffect)) return e.value
    return val
  },
})

const focusModePlugin = ViewPlugin.fromClass(class {
  decorations: ReturnType<typeof Decoration.set>
  constructor(view: EditorView) { this.decorations = this.build(view) }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.state.field(focusModeField) !== update.startState.field(focusModeField)) {
      this.decorations = this.build(update.view)
    }
  }
  build(view: EditorView) {
    if (!view.state.field(focusModeField)) return Decoration.none
    const builder = new RangeSetBuilder<Decoration>()
    const doc = view.state.doc
    const cursorLine = doc.lineAt(view.state.selection.main.head).number
    // Expand to the surrounding paragraph block: contiguous non-blank lines,
    // bounded by blank lines (or the document edges).
    let start = cursorLine
    let end = cursorLine
    while (start > 1 && doc.line(start - 1).text.trim() !== '') start--
    while (end < doc.lines && doc.line(end + 1).text.trim() !== '') end++
    for (let i = 1; i <= doc.lines; i++) {
      if (i < start || i > end) {
        const line = doc.line(i)
        builder.add(line.from, line.from, Decoration.line({ class: 'cm-focus-dim' }))
      }
    }
    return builder.finish()
  }
}, { decorations: (v) => v.decorations })

// ── Slop scorer decorations ───────────────────────────────────────────────────

export interface SlopSpan { from: number; to: number; reason: string; severity: 'low' | 'medium' | 'high' }

export const setSlopSpansEffect = StateEffect.define<SlopSpan[]>()

export const slopField = StateField.define<SlopSpan[]>({
  create: () => [],
  update(spans, tr) {
    for (const e of tr.effects) if (e.is(setSlopSpansEffect)) return e.value
    if (tr.docChanged) return [] // clear on edit
    return spans
  },
})

const slopPlugin = ViewPlugin.fromClass(class {
  decorations: ReturnType<typeof Decoration.set>
  constructor(view: EditorView) { this.decorations = this.build(view) }
  update(update: ViewUpdate) {
    if (update.docChanged || update.transactions.some((t) => t.effects.some((e) => e.is(setSlopSpansEffect)))) {
      this.decorations = this.build(update.view)
    }
  }
  build(view: EditorView) {
    const spans = view.state.field(slopField)
    if (!spans.length) return Decoration.none
    const builder = new RangeSetBuilder<Decoration>()
    const sorted = [...spans].sort((a, b) => a.from - b.from)
    for (const s of sorted) {
      if (s.from >= s.to || s.to > view.state.doc.length) continue
      builder.add(s.from, s.to, Decoration.mark({
        class: `cm-slop cm-slop-${s.severity}`,
        attributes: { title: s.reason },
      }))
    }
    return builder.finish()
  }
}, { decorations: (v) => v.decorations })

// ── Base editor theme ─────────────────────────────────────────────────────────
export const konbiniTheme = EditorView.theme({
  // No fixed height — the editor grows with content; the parent editor-wrap scrolls.
  '&': { background: 'transparent' },
  '.cm-scroller': { fontFamily: 'var(--editor-font)', fontSize: 'var(--editor-size)', overflow: 'visible !important' },
  '.cm-content': { padding: '0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-slop': { textDecoration: 'underline wavy', textDecorationSkipInk: 'none' },
  '.cm-slop-high': { textDecorationColor: 'oklch(0.65 0.18 20)' },
  '.cm-slop-medium': { textDecorationColor: 'oklch(0.70 0.14 60)' },
  '.cm-slop-low': { textDecorationColor: 'oklch(0.65 0.08 260)' },
  '.cm-selectionBackground': { background: 'var(--accent-soft)' },
  '&.cm-focused .cm-selectionBackground': { background: 'var(--accent-soft)' },
  '.cm-gutters': { display: 'none' },
  '.cm-activeLine': { background: 'transparent' },
  // heading size bumps (applied via HighlightStyle class + these rules)
  '.cm-h1': { fontSize: '1.35em' },
  '.cm-h2': { fontSize: '1.18em' },
  '.cm-h3': { fontSize: '1.06em' },
})

// ── Assembled extension set ───────────────────────────────────────────────────
export function konbiniExtensions(
  onChange?: (content: string) => void,
  onCursor?: (line: number, col: number) => void,
) {
  return [
    history(),
    search({ top: true }),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    markdown(),
    syntaxHighlighting(markdownHighlight),
    wikilinkPlugin,
    focusModeField,
    focusModePlugin,
    slopField,
    slopPlugin,
    konbiniTheme,
    EditorView.lineWrapping,
    ...(onChange || onCursor ? [EditorView.updateListener.of((u) => {
      if (onChange && u.docChanged) onChange(u.state.doc.toString())
      if (onCursor && (u.selectionSet || u.docChanged)) {
        const head = u.state.selection.main.head
        const line = u.state.doc.lineAt(head)
        onCursor(line.number, head - line.from + 1)
      }
    })] : []),
  ]
}
