import { EditorView, Decoration, ViewPlugin, ViewUpdate } from '@codemirror/view'
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { defaultKeymap, historyKeymap, history, indentWithTab } from '@codemirror/commands'
import { keymap } from '@codemirror/view'
import { search, searchKeymap } from '@codemirror/search'
import { tags } from '@lezer/highlight'
import { livePreview } from './livePreview'

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

// ── Comment anchors ───────────────────────────────────────────────────────────
//
// The editor is the only place a comment anchor can be maintained *exactly*:
// CodeMirror maps every stored position through each change, so a comment
// survives the writer rewriting the sentence it's attached to. Outside the
// editor, `reanchor` recovers positions from the quoted text (see
// shared/comments.ts) — good, but it can't follow a rewrite.
//
// Ranges are held as plain numbers rather than a RangeSet because they have to
// travel back out to the store, which knows nothing about CodeMirror.

export interface CommentSpan { id: string; from: number; to: number; resolved: boolean }

export const setCommentSpansEffect = StateEffect.define<CommentSpan[]>()

export const commentField = StateField.define<CommentSpan[]>({
  create: () => [],
  update(spans, tr) {
    for (const e of tr.effects) if (e.is(setCommentSpansEffect)) return e.value
    if (!tr.docChanged) return spans
    // assoc: `from` sticks to the text after it, `to` to the text before, so
    // typing at either edge extends the surrounding prose, not the comment.
    return spans.map((s) => ({
      ...s,
      from: tr.changes.mapPos(s.from, 1),
      to: tr.changes.mapPos(s.to, -1),
    }))
  },
})

const commentPlugin = ViewPlugin.fromClass(class {
  decorations: ReturnType<typeof Decoration.set>
  constructor(view: EditorView) { this.decorations = this.build(view) }
  update(update: ViewUpdate) {
    if (update.docChanged || update.state.field(commentField) !== update.startState.field(commentField)) {
      this.decorations = this.build(update.view)
    }
  }
  build(view: EditorView) {
    const spans = view.state.field(commentField)
    if (!spans.length) return Decoration.none
    const builder = new RangeSetBuilder<Decoration>()
    const len = view.state.doc.length
    // A resolved comment keeps a faint mark so the writer can still find it.
    const sorted = [...spans]
      .filter((s) => s.from < s.to && s.to <= len)
      .sort((a, b) => a.from - b.from || a.to - b.to)
    for (const s of sorted) {
      builder.add(s.from, s.to, Decoration.mark({
        class: `cm-comment${s.resolved ? ' cm-comment-done' : ''}`,
        attributes: { 'data-comment-id': s.id },
      }))
    }
    return builder.finish()
  }
}, { decorations: (v) => v.decorations })

// ── Name slips ────────────────────────────────────────────────────────────────
//
// Tokens that look like a misspelling of a name the project knows (see
// shared/dictionary.ts). Rendered distinctly from slop: this is a factual
// "that isn't how you spell her name", not a judgement about the prose.

export interface NameSlipSpan { from: number; to: number; word: string; suggestion: string }

export const setNameSlipsEffect = StateEffect.define<NameSlipSpan[]>()

export const nameSlipField = StateField.define<NameSlipSpan[]>({
  create: () => [],
  update(spans, tr) {
    for (const e of tr.effects) if (e.is(setNameSlipsEffect)) return e.value
    // Cleared on edit and recomputed once typing settles, rather than mapped:
    // the token under the caret is mid-word while you type, and underlining a
    // half-typed name as a mistake is a nuisance.
    if (tr.docChanged) return []
    return spans
  },
})

const nameSlipPlugin = ViewPlugin.fromClass(class {
  decorations: ReturnType<typeof Decoration.set>
  constructor(view: EditorView) { this.decorations = this.build(view) }
  update(update: ViewUpdate) {
    if (update.docChanged || update.transactions.some((t) => t.effects.some((e) => e.is(setNameSlipsEffect)))) {
      this.decorations = this.build(update.view)
    }
  }
  build(view: EditorView) {
    const spans = view.state.field(nameSlipField)
    if (!spans.length) return Decoration.none
    const builder = new RangeSetBuilder<Decoration>()
    const len = view.state.doc.length
    for (const s of [...spans].sort((a, b) => a.from - b.from)) {
      if (s.from >= s.to || s.to > len) continue
      builder.add(s.from, s.to, Decoration.mark({
        class: 'cm-nameslip',
        attributes: { title: `Did you mean “${s.suggestion}”?`, 'data-slip': s.word },
      }))
    }
    return builder.finish()
  }
}, { decorations: (v) => v.decorations })

// ── Typewriter scroll: keep the caret near 40% from the top ──────────────────
export function makeTypewriterPlugin() {
  return ViewPlugin.fromClass(class {
    update(update: ViewUpdate) {
      if (!update.docChanged && !update.selectionSet) return
      const view = update.view
      const coords = view.coordsAtPos(view.state.selection.main.head)
      if (!coords) return
      const scrollEl = view.scrollDOM
      const editorRect = scrollEl.getBoundingClientRect()
      const relTop = coords.top - editorRect.top
      if (relTop > editorRect.height * 0.4) {
        const targetScrollTop = scrollEl.scrollTop + relTop - editorRect.height * 0.4
        scrollEl.scrollTo({ top: targetScrollTop, behavior: 'smooth' })
      }
    }
  })
}

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
  // Comments read as a highlighter pass over the prose, not as an error.
  '.cm-comment': {
    background: 'color-mix(in oklch, var(--accent) 16%, transparent)',
    borderBottom: '1px solid color-mix(in oklch, var(--accent) 45%, transparent)',
    cursor: 'pointer',
  },
  // A name slip is a fact, not an opinion: dotted, in the warning hue, and
  // distinct from slop's wavy underline.
  '.cm-nameslip': {
    textDecoration: 'underline dotted',
    textDecorationThickness: '2px',
    textUnderlineOffset: '2px',
    textDecorationColor: 'oklch(0.70 0.14 60)',
    cursor: 'help',
  },
  '.cm-comment-done': {
    background: 'transparent',
    borderBottom: '1px dotted var(--border-2)',
  },
  '.cm-selectionBackground': { background: 'var(--accent-soft)' },
  '&.cm-focused .cm-selectionBackground': { background: 'var(--accent-soft)' },
  '.cm-gutters': { display: 'none' },
  '.cm-activeLine': { background: 'transparent' },
  // Heading sizing is done per-line by livePreview (.cm-lp-h*) so it doesn't
  // compound with the span-level heading classes.
})

// ── Assembled extension set ───────────────────────────────────────────────────
export function konbiniExtensions(
  onChange?: (content: string) => void,
  onCursor?: (line: number, col: number) => void,
  /** Fires after a change has moved comment anchors, so they can be persisted. */
  onCommentSpans?: (spans: CommentSpan[]) => void,
) {
  return [
    history(),
    search({ top: true }),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    markdown(),
    syntaxHighlighting(markdownHighlight),
    focusModeField,
    focusModePlugin,
    slopField,
    slopPlugin,
    commentField,
    commentPlugin,
    nameSlipField,
    nameSlipPlugin,
    konbiniTheme,
    EditorView.lineWrapping,
    ...(onChange || onCursor || onCommentSpans ? [EditorView.updateListener.of((u) => {
      if (onChange && u.docChanged) onChange(u.state.doc.toString())
      if (onCommentSpans && u.docChanged) {
        const spans = u.state.field(commentField)
        if (spans.length) onCommentSpans(spans)
      }
      if (onCursor && (u.selectionSet || u.docChanged)) {
        const head = u.state.selection.main.head
        const line = u.state.doc.lineAt(head)
        onCursor(line.number, head - line.from + 1)
      }
    })] : []),
  ]
}
