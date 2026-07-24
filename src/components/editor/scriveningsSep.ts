import { EditorView, Decoration, WidgetType, type DecorationSet } from '@codemirror/view'
import { StateField, StateEffect, EditorState, Facet, Annotation, type Range } from '@codemirror/state'

// ── Scrivenings separator primitive ─────────────────────────────────────────
// A folder's scenes are edited as ONE buffer, joined by a protected sentinel.
// The sentinel token is rendered as a non-editable scene divider (atomicRanges +
// changeFilter keep it intact), so the buffer always contains exactly N-1 tokens
// for N scenes — write-back extracts each scene's text by the token positions.
// The token uses private-use characters so it can never occur in real prose, and
// it is stripped before anything is written to disk.

export const SEP_TOKEN = '⟦konbini-scene-break⟧'
export const SEP = '\n' + SEP_TOKEN + '\n'

export interface SceneMeta { id: string; title: string; color: string }

/** Join per-scene contents into the combined buffer. */
export function buildBuffer(segs: string[]): string {
  return segs.join(SEP)
}

/**
 * Split the combined buffer back into per-scene contents by locating the
 * (always-intact) tokens, then stripping the one structural newline the SEP adds
 * on each side. Conditional stripping tolerates a structural newline that a stray
 * edit removed, so content can never corrupt — only divider spacing.
 */
export function extractSegments(buffer: string): string[] {
  const raw: string[] = []
  let cursor = 0
  let idx: number
  while ((idx = buffer.indexOf(SEP_TOKEN, cursor)) !== -1) {
    raw.push(buffer.slice(cursor, idx))
    cursor = idx + SEP_TOKEN.length
  }
  raw.push(buffer.slice(cursor))
  const last = raw.length - 1
  return raw.map((p, i) => {
    let s = p
    if (i > 0 && s.startsWith('\n')) s = s.slice(1)       // '\n' after the previous token
    if (i < last && s.endsWith('\n')) s = s.slice(0, -1)  // '\n' before the next token
    return s
  })
}

// Click handler for dividers, configured once at view creation.
export const scrivSelectFacet = Facet.define<(id: string) => void, (id: string) => void>({
  combine: (v) => v[v.length - 1] ?? (() => {}),
})

// Programmatic dispatches (rebuild / external reconcile) carry this so the
// changeFilter lets them through even though they overlap protected tokens.
export const scrivBypass = Annotation.define<boolean>()

// Set the ordered scene metadata (labels the dividers); dispatched with the
// full-buffer replace on a structural rebuild.
export const setScenesEffect = StateEffect.define<SceneMeta[]>()

class SepWidget extends WidgetType {
  constructor(readonly id: string, readonly title: string, readonly color: string) { super() }
  eq(other: SepWidget) { return other.id === this.id && other.title === this.title && other.color === this.color }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('span')
    el.className = 'scriv-sep'
    el.setAttribute('contenteditable', 'false')
    const dot = document.createElement('span')
    dot.className = 'scriv-sep-dot'
    dot.style.background = this.color
    const label = document.createElement('span')
    label.className = 'scriv-sep-title'
    label.textContent = this.title
    el.appendChild(dot)
    el.appendChild(label)
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.state.facet(scrivSelectFacet)(this.id)
    })
    return el
  }
  ignoreEvent() { return false }
}

// Scan the doc for tokens; the k-th token divides scene k and k+1, so it is
// labelled with the following scene (scenes[k+1]).
function buildDecorations(doc: { toString(): string }, scenes: SceneMeta[]): DecorationSet {
  const text = doc.toString()
  const ranges: Range<Decoration>[] = []
  let cursor = 0
  let idx: number
  let k = 0
  while ((idx = text.indexOf(SEP_TOKEN, cursor)) !== -1) {
    const next = scenes[k + 1]
    const widget = new SepWidget(next?.id ?? '', next?.title ?? '', next?.color ?? 'var(--border-2)')
    ranges.push(Decoration.replace({ widget }).range(idx, idx + SEP_TOKEN.length))
    cursor = idx + SEP_TOKEN.length
    k++
  }
  return Decoration.set(ranges, true)
}

interface SepState { scenes: SceneMeta[]; deco: DecorationSet }

export const sepField = StateField.define<SepState>({
  create: () => ({ scenes: [], deco: Decoration.none }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setScenesEffect)) {
        return { scenes: e.value, deco: buildDecorations(tr.newDoc, e.value) }
      }
    }
    if (tr.docChanged) {
      // Tokens are protected, so they only shift — map the decos, keep the widgets.
      return { scenes: value.scenes, deco: value.deco.map(tr.changes) }
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
})

// Caret skips the divider; arrow-over and click-through both land outside it.
export const scriveningsAtomic = EditorView.atomicRanges.of((view) => view.state.field(sepField).deco)

// Reject any user edit that overlaps a token, so the N-1-token invariant holds
// by construction. Our own programmatic rebuild/reconcile dispatches carry the
// bypass annotation.
export const scriveningsGuard = EditorState.changeFilter.of((tr) => {
  if (tr.annotation(scrivBypass)) return true
  const { deco } = tr.startState.field(sepField)
  const ranges: number[] = []
  const it = deco.iter()
  while (it.value) { ranges.push(it.from, it.to); it.next() }
  return ranges
})

export const scriveningsExtensions = [sepField, scriveningsAtomic, scriveningsGuard]

// ── Buffer ↔ scene mapping (for AI cowrite / beat inside the combined buffer) ──
// Locate the clean-content [from,to) of each scene in the live buffer by the
// (always-intact) token positions, mirroring extractSegments' newline stripping.
export interface SegBound { sceneId: string; from: number; to: number }

export function segmentBounds(buffer: string, ids: string[]): SegBound[] {
  if (ids.length === 0) return []
  const tokens: number[] = []
  for (let c = 0, idx = 0; (idx = buffer.indexOf(SEP_TOKEN, c)) !== -1; c = idx + SEP_TOKEN.length) tokens.push(idx)
  if (tokens.length !== ids.length - 1) return [] // buffer/model out of sync
  const last = ids.length - 1
  const out: SegBound[] = []
  for (let i = 0; i < ids.length; i++) {
    let from = i === 0 ? 0 : tokens[i - 1] + SEP_TOKEN.length
    let to = i === last ? buffer.length : tokens[i]
    if (i > 0 && buffer[from] === '\n') from += 1            // '\n' after the previous token
    if (i < last && to > 0 && buffer[to - 1] === '\n') to -= 1 // '\n' before the next token
    out.push({ sceneId: ids[i], from, to })
  }
  return out
}

/** Map a buffer position to a scene + offset within that scene's content. */
export function sceneAtPos(buffer: string, ids: string[], pos: number): { sceneId: string; offset: number } | null {
  const bounds = segmentBounds(buffer, ids)
  if (bounds.length === 0) return null
  for (const b of bounds) if (pos >= b.from && pos <= b.to) return { sceneId: b.sceneId, offset: pos - b.from }
  // In a divider/structural gap → snap to the nearest scene boundary.
  for (const b of bounds) if (pos < b.from) return { sceneId: b.sceneId, offset: 0 }
  const lastB = bounds[bounds.length - 1]
  return { sceneId: lastB.sceneId, offset: lastB.to - lastB.from }
}

/** Map a buffer range to a scene-local range, or null if it spans scenes/dividers. */
export function sceneRangeForRange(buffer: string, ids: string[], from: number, to: number): { sceneId: string; from: number; to: number } | null {
  const bounds = segmentBounds(buffer, ids)
  const b = bounds.find((s) => from >= s.from && to <= s.to)
  return b ? { sceneId: b.sceneId, from: from - b.from, to: to - b.from } : null
}
