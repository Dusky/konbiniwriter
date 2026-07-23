// RetrievalService.ts — lexical (BM25) retrieval over the manuscript.
//
// The tiered ContextBuilder dumps recent scenes, but for a long book the most
// *relevant* prior passage is rarely the most recent one. This ranks passages
// from across the project by BM25 against a query (the current scene, or an
// explicit question) so drafting/chat can see the pertinent earlier material.
//
// Lexical by design: zero dependencies, offline, works with any provider. An
// optional BYOK embeddings upgrade can layer on later without changing callers.

import type { Project, ID } from '@shared/types'

export interface Passage { docId: ID; title: string; text: string; score: number }

// Small, generic English stoplist — enough to keep scoring from being dominated
// by function words without a linguistics dependency.
const STOP = new Set(
  ('a an the and or but if then else of to in on at for with by from as is are was were be been being it its ' +
   'this that these those i you he she they we them his her their our your my me him us do does did not no so ' +
   'than too very can will just into out up down over under again more most about after before').split(' '),
)

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter((t) => t.length > 2 && !STOP.has(t))
}

// Split a document into passage-sized chunks along paragraph breaks, merging
// short paragraphs up to a target length so each chunk carries real context.
function chunkDoc(text: string, target = 700): string[] {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const chunks: string[] = []
  let cur = ''
  for (const p of paras) {
    if (cur && cur.length + p.length > target) { chunks.push(cur); cur = p }
    else cur = cur ? `${cur}\n\n${p}` : p
    if (cur.length > target * 1.6) { chunks.push(cur); cur = '' }
  }
  if (cur) chunks.push(cur)
  return chunks
}

interface IndexedPassage { docId: ID; title: string; text: string; tf: Map<string, number>; len: number }
interface Index { passages: IndexedPassage[]; df: Map<string, number>; avgdl: number; n: number }

function isInTrash(project: Project, id: ID): boolean {
  let cur: ID | null | undefined = id
  const seen = new Set<ID>()
  while (cur && !seen.has(cur)) {
    if (cur === project.trashId) return true
    seen.add(cur)
    cur = project.nodes[cur]?.parentId
  }
  return false
}

function buildIndex(project: Project, excludeDocId: ID | undefined): Index {
  const passages: IndexedPassage[] = []
  const df = new Map<string, number>()
  for (const [id, body] of Object.entries(project.docs)) {
    if (id === excludeDocId) continue
    const node = project.nodes[id]
    if (!node || node.type === 'folder' || isInTrash(project, id)) continue
    for (const chunk of chunkDoc(body.content)) {
      const toks = tokenize(chunk)
      if (toks.length === 0) continue
      const tf = new Map<string, number>()
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1)
      for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1)
      passages.push({ docId: id, title: node.title, text: chunk, tf, len: toks.length })
    }
  }
  const n = passages.length
  const avgdl = n ? passages.reduce((s, p) => s + p.len, 0) / n : 0
  return { passages, df, avgdl, n }
}

// Cache the index between calls; a cheap signature (doc count + total length +
// exclusion) rebuilds it only when the corpus actually changed.
let _cache: { key: string; index: Index } | null = null

function signature(project: Project, excludeDocId: ID | undefined): string {
  let total = 0
  let count = 0
  for (const [id, body] of Object.entries(project.docs)) {
    if (id === excludeDocId) continue
    total += body.content.length
    count++
  }
  return `${project.id}:${count}:${total}:${excludeDocId ?? ''}`
}

export interface RetrieveOpts { excludeDocId?: ID; limit?: number; maxChars?: number }

/** Rank passages from across the project by BM25 against `query`. */
export function retrieve(project: Project, query: string, opts: RetrieveOpts = {}): Passage[] {
  const key = signature(project, opts.excludeDocId)
  if (!_cache || _cache.key !== key) _cache = { key, index: buildIndex(project, opts.excludeDocId) }
  const idx = _cache.index
  if (idx.n === 0) return []

  const qTerms = [...new Set(tokenize(query))]
  if (qTerms.length === 0) return []

  const k1 = 1.5
  const b = 0.75
  const scored: Passage[] = []
  for (const p of idx.passages) {
    let score = 0
    for (const t of qTerms) {
      const dfT = idx.df.get(t)
      const f = p.tf.get(t)
      if (!dfT || !f) continue
      const idf = Math.log(1 + (idx.n - dfT + 0.5) / (dfT + 0.5))
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (p.len / idx.avgdl)))
    }
    if (score > 0) scored.push({ docId: p.docId, title: p.title, text: p.text, score })
  }
  scored.sort((a, b2) => b2.score - a.score)

  const limit = opts.limit ?? 6
  const maxChars = opts.maxChars ?? 4000
  const out: Passage[] = []
  let chars = 0
  for (const p of scored) {
    if (out.length >= limit) break
    if (out.length > 0 && chars + p.text.length > maxChars) continue
    out.push(p)
    chars += p.text.length
  }
  return out
}
