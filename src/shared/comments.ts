// comments.ts — margin notes anchored to a span of prose.
//
// A comment points at a range of text, and prose moves. Two mechanisms keep
// the pointer honest, and they cover different failures:
//
//   • While the document is open, CodeMirror maps every anchor through each
//     change, so editing *inside* a commented span carries the comment along.
//     That's the only mechanism that can survive a rewrite of the quoted text.
//   • While the document is closed — a snapshot restore, an applied proposal,
//     a sync merge, an external editor — offsets go stale silently. So nothing
//     ever trusts the stored offsets on read: `reanchor` re-locates the comment
//     by its quoted text and only falls back to the offsets as a hint.
//
// When the quote is gone entirely the comment is marked orphaned rather than
// pointed at whatever text now occupies those offsets. Showing a note beside
// the wrong sentence is worse than showing it detached.
//
// Pure — no DOM, no Node. Imported by both the renderer and Electron main.

import type { ID, ISO } from './types'

export interface CommentAnchor {
  from: number
  to: number
  /** The exact text this comment was attached to. The recovery key. */
  quote: string
}

export type CommentOrigin = 'author' | 'ai'

export interface Comment {
  id: ID
  docId: ID
  anchor: CommentAnchor
  body: string
  /** Display name — the writer, or the agent that raised it. */
  author: string
  origin: CommentOrigin
  /** Set for AI comments so the rail can group by which agent spoke. */
  agentId?: string
  createdAt: ISO
  modifiedAt: ISO
  resolved: boolean
}

/** A comment resolved against the document as it currently reads. */
export interface AnchoredComment extends Comment {
  /** Where it actually points now — may differ from `anchor`. */
  live: { from: number; to: number }
  /** True when the quoted text is no longer anywhere in the document. */
  orphaned: boolean
}

/** All occurrences of `needle` in `hay`, including overlapping ones. */
function occurrences(hay: string, needle: string): number[] {
  const out: number[] = []
  if (!needle) return out
  let i = hay.indexOf(needle)
  while (i !== -1) {
    out.push(i)
    i = hay.indexOf(needle, i + 1)
  }
  return out
}

/**
 * Resolve a comment against the current document text.
 *
 * The stored offsets are a hint, not a fact. If the quote still sits exactly
 * where the offsets say, nothing moved. Otherwise the quote is searched for
 * and the occurrence *closest to the old position* wins — the standard
 * disambiguation when a phrase repeats, and the one that behaves correctly
 * when text is inserted above the comment.
 */
export function reanchor(comment: Comment, content: string): AnchoredComment {
  const { from, to, quote } = comment.anchor
  const len = content.length

  // A comment with no quoted text is a point marker; just keep it in bounds.
  if (!quote) {
    const p = Math.min(Math.max(from, 0), len)
    return { ...comment, live: { from: p, to: p }, orphaned: false }
  }

  // Fast path: still exactly where we left it.
  if (from >= 0 && content.startsWith(quote, from)) {
    return { ...comment, live: { from, to: from + quote.length }, orphaned: false }
  }

  const hits = occurrences(content, quote)
  if (hits.length === 0) {
    const clamped = Math.min(Math.max(from, 0), len)
    return {
      ...comment,
      live: { from: clamped, to: Math.min(Math.max(to, clamped), len) },
      orphaned: true,
    }
  }

  let best = hits[0]
  for (const h of hits) {
    if (Math.abs(h - from) < Math.abs(best - from)) best = h
  }
  return { ...comment, live: { from: best, to: best + quote.length }, orphaned: false }
}

/**
 * Every comment on a document, resolved against its current text and ordered
 * the way a reader moves through the page: unresolved first, then by position.
 */
export function anchoredFor(comments: Comment[], docId: ID, content: string): AnchoredComment[] {
  return comments
    .filter((c) => c.docId === docId)
    .map((c) => reanchor(c, content))
    .sort((a, b) => {
      if (a.resolved !== b.resolved) return a.resolved ? 1 : -1
      if (a.orphaned !== b.orphaned) return a.orphaned ? 1 : -1
      return a.live.from - b.live.from || a.createdAt.localeCompare(b.createdAt)
    })
}

/** Count of open (unresolved) comments on a document. */
export function openCount(comments: Comment[], docId: ID): number {
  let n = 0
  for (const c of comments) if (c.docId === docId && !c.resolved) n++
  return n
}

/**
 * Trim a selection down to something worth quoting: a comment anchored to
 * leading whitespace drifts as soon as the paragraph reflows.
 */
export function trimAnchor(content: string, from: number, to: number): { from: number; to: number } {
  let a = Math.min(Math.max(from, 0), content.length)
  let b = Math.min(Math.max(to, 0), content.length)
  if (a > b) [a, b] = [b, a]
  while (a < b && /\s/.test(content[a])) a++
  while (b > a && /\s/.test(content[b - 1])) b--
  return { from: a, to: b }
}

/** Shorten a quote for display in the rail without cutting mid-word. */
export function excerpt(quote: string, max = 60): string {
  const flat = quote.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut) + '…'
}
