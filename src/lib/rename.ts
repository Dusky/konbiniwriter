// rename.ts — renaming a character (or place, or anything named) everywhere.
//
// Project-wide replace rewrites prose and stops there, which leaves the rest of
// the project quietly disagreeing with the manuscript: the scene still titled
// "Mira and the River", the codex entry still filed under Mira, the synopsis on
// the corkboard, the keyword you filter the binder by, and — worst of the set —
// every comment anchored by a quote that no longer exists, which orphans the
// note rather than moving it.
//
// So this plans the whole rename first and hands back an inventory the author
// can look at before anything happens. Pure: no store, no I/O, no DOM. The
// caller decides what to do with the plan, and is the one that snapshots.

import { makeMatcher, countMatches, replaceWith, type MatchOptions } from './findReplace'
import type { CodexEntry, ID, Project } from '@shared/types'
import type { Comment, CommentAnchor } from '@shared/comments'

/** A document whose prose contains the name. */
export interface DocEdit {
  id: ID
  title: string
  count: number
  original: string
  proposed: string
}

/** A single-string field on a node — its title, or its synopsis. */
export interface FieldEdit {
  id: ID
  /** The node's title, for showing the author where this is. */
  where: string
  from: string
  to: string
}

export interface KeywordEdit { id: ID; where: string; from: string[]; to: string[] }

export interface CodexEdit {
  id: ID
  entryName: string
  next: CodexEntry
  /** Which parts changed — 'name', 'aliases', 'summary', 'facts'. */
  changed: string[]
}

export interface CommentEdit {
  id: ID
  docId: ID
  /** Only the quote and body are touched; offsets are the caller's business. */
  anchor: CommentAnchor
  body: string
  changed: ('quote' | 'body')[]
}

export interface RenamePlan {
  from: string
  to: string
  docs: DocEdit[]
  titles: FieldEdit[]
  synopses: FieldEdit[]
  keywords: KeywordEdit[]
  codex: CodexEdit[]
  comments: CommentEdit[]
  /** Every occurrence, everywhere — what the confirm button counts. */
  total: number
  /** True when nothing anywhere matches. */
  empty: boolean
}

/**
 * Defaults tuned for a name rather than a phrase.
 *
 * Whole-word keeps "Mira" out of "admiral" while still catching `[[Mira]]` and
 * `Mira's` — the brackets and the apostrophe are word boundaries. Case-sensitive
 * keeps a shouted "MIRA!" from being quietly downcased to the new spelling; the
 * author can turn either off.
 */
export const NAME_DEFAULTS: MatchOptions = { wholeWord: true, caseSensitive: true }

const sub = (text: string, m: RegExp, to: string): string => replaceWith(text, m, to)

/**
 * Keywords are slugs, not prose — `pov-mira`, `mira-arc` — so they get their
 * own rule: always matched case-insensitively, and rewritten in the case the
 * tag already used. A case-sensitive rename of "Mira" would otherwise skip
 * every lowercase tag and leave the binder filtering on a name the book no
 * longer contains, which is exactly the staleness this whole operation exists
 * to prevent. Prose is deliberately *not* treated this way: there, the case the
 * author typed is a choice.
 */
function renameKeyword(keyword: string, from: string, to: string, opts: MatchOptions): string {
  const m = makeMatcher(from, { ...opts, caseSensitive: false })
  if (!m) return keyword
  return keyword.replace(m, (hit) => {
    if (hit === hit.toLowerCase()) return to.toLowerCase()
    if (hit === hit.toUpperCase() && hit !== hit.toLowerCase()) return to.toUpperCase()
    return to
  })
}

export function planRename(
  project: Project,
  from: string,
  to: string,
  opts: MatchOptions = NAME_DEFAULTS,
): RenamePlan {
  const empty: RenamePlan = { from, to, docs: [], titles: [], synopses: [], keywords: [], codex: [], comments: [], total: 0, empty: true }
  const trimmed = from.trim()
  if (!trimmed || !to.trim() || trimmed === to) return empty
  const matcher = makeMatcher(trimmed, opts)
  if (!matcher) return empty

  const plan: RenamePlan = { ...empty, from: trimmed, to, docs: [], titles: [], synopses: [], keywords: [], codex: [], comments: [] }
  let total = 0

  for (const node of Object.values(project.nodes)) {
    if (node.id === project.trashId) continue

    const titleHits = countMatches(node.title, matcher)
    if (titleHits > 0) {
      plan.titles.push({ id: node.id, where: node.title, from: node.title, to: sub(node.title, matcher, to) })
      total += titleHits
    }

    const synopsis = node.meta.synopsis ?? ''
    const synHits = countMatches(synopsis, matcher)
    if (synHits > 0) {
      plan.synopses.push({ id: node.id, where: node.title, from: synopsis, to: sub(synopsis, matcher, to) })
      total += synHits
    }

    const keywords = node.meta.keywords ?? []
    const nextKeywords = keywords.map((k) => renameKeyword(k, trimmed, to, opts))
    if (nextKeywords.some((k, i) => k !== keywords[i])) {
      plan.keywords.push({ id: node.id, where: node.title, from: keywords, to: nextKeywords })
      total += keywords.filter((k, i) => nextKeywords[i] !== k).length
    }

    if (node.type === 'folder') continue
    const content = project.docs[node.id]?.content ?? ''
    const hits = countMatches(content, matcher)
    if (hits > 0) {
      plan.docs.push({ id: node.id, title: node.title, count: hits, original: content, proposed: sub(content, matcher, to) })
      total += hits
    }
  }

  for (const entry of ((project.settings.codex as CodexEntry[] | undefined) ?? [])) {
    const changed: string[] = []
    const name = sub(entry.name, matcher, to)
    if (name !== entry.name) { changed.push('name'); total += countMatches(entry.name, matcher) }
    const aliases = entry.aliases.map((a) => sub(a, matcher, to))
    if (aliases.some((a, i) => a !== entry.aliases[i])) { changed.push('aliases'); total += aliases.filter((a, i) => a !== entry.aliases[i]).length }
    const summary = sub(entry.summary ?? '', matcher, to)
    if (summary !== (entry.summary ?? '')) { changed.push('summary'); total += countMatches(entry.summary ?? '', matcher) }
    const facts = (entry.facts ?? []).map((f) => ({ ...f, value: sub(f.value, matcher, to), label: sub(f.label, matcher, to) }))
    if (facts.some((f, i) => f.value !== entry.facts?.[i]?.value || f.label !== entry.facts?.[i]?.label)) {
      changed.push('facts')
      total += facts.filter((f, i) => f.value !== entry.facts?.[i]?.value || f.label !== entry.facts?.[i]?.label).length
    }
    if (changed.length) {
      plan.codex.push({
        id: entry.id,
        entryName: entry.name,
        changed,
        next: { ...entry, name, aliases, summary, facts, modifiedAt: new Date().toISOString() },
      })
    }
  }

  // Comments recover by their quoted text (see shared/comments.ts). Rewriting
  // the prose without rewriting the quote is what orphans a note — so this is
  // the part of the rename that prevents a loss rather than tidying one.
  for (const comment of ((project.settings.comments as Comment[] | undefined) ?? [])) {
    const quote = sub(comment.anchor.quote, matcher, to)
    const body = sub(comment.body, matcher, to)
    const changed: ('quote' | 'body')[] = []
    if (quote !== comment.anchor.quote) changed.push('quote')
    if (body !== comment.body) changed.push('body')
    if (changed.length) {
      plan.comments.push({ id: comment.id, docId: comment.docId, anchor: { ...comment.anchor, quote }, body, changed })
      total += changed.length
    }
  }

  plan.total = total
  plan.empty = total === 0
  return plan
}

/** One line summarising what a plan will touch, for the confirm button. */
export function describePlan(plan: RenamePlan): string {
  if (plan.empty) return 'Nothing matches'
  const parts: string[] = []
  const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
  if (plan.docs.length) parts.push(n(plan.docs.reduce((a, d) => a + d.count, 0), 'mention') + ` in ${n(plan.docs.length, 'document')}`)
  if (plan.titles.length) parts.push(n(plan.titles.length, 'title'))
  if (plan.synopses.length) parts.push(n(plan.synopses.length, 'synopsis', 'synopses'))
  if (plan.keywords.length) parts.push(n(plan.keywords.length, 'keyword set'))
  if (plan.codex.length) parts.push(n(plan.codex.length, 'codex entry', 'codex entries'))
  if (plan.comments.length) parts.push(n(plan.comments.length, 'comment'))
  return parts.join(' · ')
}
