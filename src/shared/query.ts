// query.ts — asking the binder questions.
//
// A manuscript stops fitting in the writer's head somewhere around 40k words.
// Past that, "every scene with Mira, POV Alex, still in Draft, under 1,500
// words" is a question the outline can't answer by being scrolled. This is the
// query engine behind keyword filtering and saved Collections.
//
// The query is a *structured value*, not a search string, for two reasons: the
// UI builds it from controls rather than parsing what someone typed, and a
// saved Collection is then a plain JSON object that survives round-tripping
// through the manifest without a parser to keep bug-compatible.
//
// Pure — no DOM, no Node.

import type { ID, LabelId, StatusId, NodeType, Project } from './types'
import { wordCount } from './utils'

export interface NodeQuery {
  /** Substring match over title, synopsis, and body. Case-insensitive. */
  text?: string
  /** Every listed keyword must be present (AND) — filters narrow, they don't widen. */
  keywords?: string[]
  /** Any of these labels (OR). Empty/absent means "don't care". */
  labels?: LabelId[]
  /** Any of these statuses (OR). */
  statuses?: StatusId[]
  /** Any of these node types (OR). */
  types?: NodeType[]
  includeInCompile?: boolean
  minWords?: number
  maxWords?: number
}

/** A saved query the writer named and kept. */
export interface Collection {
  id: ID
  name: string
  query: NodeQuery
  createdAt: string
  modifiedAt: string
}

/** True when the query would filter nothing out. */
export function isEmptyQuery(q: NodeQuery): boolean {
  return !q.text?.trim()
    && !q.keywords?.length
    && !q.labels?.length
    && !q.statuses?.length
    && !q.types?.length
    && q.includeInCompile === undefined
    && q.minWords === undefined
    && q.maxWords === undefined
}

/** Keywords are compared case-insensitively and trimmed; this is the canonical form. */
export const normalizeKeyword = (k: string): string => k.trim().toLowerCase()

/**
 * Clean up a raw keyword list: trimmed, de-duplicated case-insensitively,
 * empties dropped. First spelling of a keyword wins so the writer's own
 * capitalisation survives.
 */
export function normalizeKeywords(raw: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const k of raw) {
    const trimmed = k.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

/** Every keyword in use across the project, sorted, for autocomplete. */
export function allKeywords(project: Project): string[] {
  const byLower = new Map<string, string>()
  for (const node of Object.values(project.nodes)) {
    for (const k of node.meta.keywords ?? []) {
      const key = normalizeKeyword(k)
      if (key && !byLower.has(key)) byLower.set(key, k.trim())
    }
  }
  return [...byLower.values()].sort((a, b) => a.localeCompare(b))
}

/** How many nodes carry each keyword — drives the keyword browser's counts. */
export function keywordCounts(project: Project): Map<string, number> {
  const counts = new Map<string, number>()
  for (const node of Object.values(project.nodes)) {
    for (const k of normalizeKeywords(node.meta.keywords ?? [])) {
      const key = normalizeKeyword(k)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

/** Does one node satisfy the query? */
export function matchesQuery(project: Project, id: ID, q: NodeQuery): boolean {
  const node = project.nodes[id]
  if (!node) return false

  if (q.types?.length && !q.types.includes(node.type)) return false
  if (q.labels?.length && !q.labels.includes(node.meta.label)) return false
  if (q.statuses?.length && !q.statuses.includes(node.meta.status)) return false
  if (q.includeInCompile !== undefined && node.meta.includeInCompile !== q.includeInCompile) return false

  if (q.keywords?.length) {
    const have = new Set((node.meta.keywords ?? []).map(normalizeKeyword))
    for (const want of q.keywords) {
      if (!have.has(normalizeKeyword(want))) return false
    }
  }

  // Word bounds only mean something for a document; a folder has no body of
  // its own, so a word filter excludes folders rather than counting them as 0.
  if (q.minWords !== undefined || q.maxWords !== undefined) {
    if (node.type === 'folder') return false
    const words = wordCount(project.docs[id]?.content ?? '')
    if (q.minWords !== undefined && words < q.minWords) return false
    if (q.maxWords !== undefined && words > q.maxWords) return false
  }

  const text = q.text?.trim().toLowerCase()
  if (text) {
    const hay = [
      node.title,
      node.meta.synopsis,
      project.docs[id]?.content ?? '',
    ].join('\n').toLowerCase()
    if (!hay.includes(text)) return false
  }

  return true
}

/**
 * Every matching node, in binder order (depth-first over the tree) so results
 * read as an outline rather than as an arbitrary list. The Trash subtree is
 * excluded — a filter is for finding live work.
 */
export function runQuery(project: Project, q: NodeQuery): ID[] {
  const out: ID[] = []
  const walk = (ids: ID[]) => {
    for (const id of ids) {
      const node = project.nodes[id]
      if (!node) continue
      if (id === project.trashId) continue
      if (matchesQuery(project, id, q)) out.push(id)
      walk(node.childIds)
    }
  }
  walk(project.rootIds)
  return out
}
