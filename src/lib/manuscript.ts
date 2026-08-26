// What counts as "the manuscript".
//
// Several surfaces need the same answer and each used to work it out for
// itself, wrongly. Adventure defaulted to the last written document anywhere in
// the project — a character sheet — and drafted a novel into it. Manuscript
// Quality carried a comment promising "compile-eligible docs, in binder order
// (skips Trash)" above a walk of every root, Trash included, so character
// sheets and research notes were scored for prose quality beside scenes.
//
// The manuscript is the first root folder: the same root Compile defaults to,
// and the one the templates create as "Manuscript".

import type { ID, Project } from '@shared/types'

export interface ManuscriptDoc {
  id: ID
  title: string
  /** The folder directly holding it — the only way to tell two same-named documents apart. */
  parentTitle: string
  content: string
}

/** The manuscript root, or null in a project that has no folders at all. */
export function manuscriptRoot(project: Project): ID | null {
  return project.rootIds.find((id) => id !== project.trashId && project.nodes[id]?.type === 'folder') ?? null
}

/**
 * Every document in the manuscript, in binder order.
 *
 * Trash is excluded because a scene you deleted is not part of your book, and
 * anything outside the manuscript root is excluded because a character sheet is
 * scaffolding — judging its prose is meaningless and costs a model call.
 */
export function manuscriptDocs(project: Project): ManuscriptDoc[] {
  const root = manuscriptRoot(project)
  if (!root) return []
  const out: ManuscriptDoc[] = []
  const walk = (ids: ID[], parentTitle: string) => {
    for (const id of ids) {
      const n = project.nodes[id]
      if (!n || id === project.trashId) continue
      if (n.type !== 'folder') {
        if (n.meta.includeInCompile) {
          out.push({ id, title: n.title, parentTitle, content: project.docs[id]?.content ?? '' })
        }
      } else {
        walk(n.childIds, n.title)
      }
    }
  }
  walk(project.nodes[root]?.childIds ?? [], project.nodes[root]?.title ?? '')
  return out
}

/** Titles that appear more than once, so the UI knows which rows need their folder shown. */
export function ambiguousTitles(docs: ManuscriptDoc[]): Set<string> {
  const seen = new Map<string, number>()
  for (const d of docs) seen.set(d.title, (seen.get(d.title) ?? 0) + 1)
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([t]) => t))
}
