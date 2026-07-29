import type { ID } from '@shared/types'

// Scans document content for [[wikilink]] mentions.
// Returns normalized alias strings (lowercased, trimmed).
const WIKILINK_RE = /\[\[([^\]|#\n]+?)(?:[|#][^\]]*?)?\]\]/g

function extractMentions(content: string): string[] {
  const aliases: string[] = []
  let m: RegExpExecArray | null
  WIKILINK_RE.lastIndex = 0
  while ((m = WIKILINK_RE.exec(content)) !== null) {
    const alias = m[1].trim().toLowerCase()
    if (alias) aliases.push(alias)
  }
  return aliases
}

export interface MentionIndex {
  // alias (lowercased) → set of docIds that mention it
  aliasToDocIds: Map<string, Set<ID>>
  // docId → set of aliases mentioned in that doc
  docToAliases: Map<ID, Set<string>>
}

export function buildIndex(docs: Record<ID, { content: string }>): MentionIndex {
  const aliasToDocIds = new Map<string, Set<ID>>()
  const docToAliases = new Map<ID, Set<string>>()

  for (const [docId, body] of Object.entries(docs)) {
    const aliases = extractMentions(body.content)
    docToAliases.set(docId, new Set(aliases))
    for (const alias of aliases) {
      if (!aliasToDocIds.has(alias)) aliasToDocIds.set(alias, new Set())
      aliasToDocIds.get(alias)!.add(docId)
    }
  }

  return { aliasToDocIds, docToAliases }
}

export function updateIndex(
  index: MentionIndex,
  docId: ID,
  content: string,
): MentionIndex {
  const aliasToDocIds = new Map(index.aliasToDocIds)
  const docToAliases = new Map(index.docToAliases)

  // Remove stale entries for this doc
  const prev = docToAliases.get(docId) ?? new Set<string>()
  for (const alias of prev) {
    const ids = aliasToDocIds.get(alias)
    if (ids) {
      ids.delete(docId)
      if (ids.size === 0) aliasToDocIds.delete(alias)
    }
  }

  // Add fresh entries
  const fresh = new Set(extractMentions(content))
  docToAliases.set(docId, fresh)
  for (const alias of fresh) {
    if (!aliasToDocIds.has(alias)) aliasToDocIds.set(alias, new Set())
    aliasToDocIds.get(alias)!.add(docId)
  }

  return { aliasToDocIds, docToAliases }
}

/** Which docs mention this alias (e.g. a character name or location). */
export function backlinksFor(index: MentionIndex, alias: string): ID[] {
  return [...(index.aliasToDocIds.get(alias.toLowerCase()) ?? [])]
}

/** Which aliases are mentioned in this doc. */
export function mentionsIn(index: MentionIndex, docId: ID): string[] {
  return [...(index.docToAliases.get(docId) ?? [])]
}
