// shared/importer.ts — build a Konbini Project from a set of imported files.
//
// The renderer reads the source files (File API / Node fs) and passes plain
// { path, content } records; this builds the binder tree (folders from path
// segments, one document per file) so every backend can write the bundle the
// same way. DOM/Node-free — imported by renderer and Electron main alike.

import type { Project, KNode, DocMeta, ID, ImportDoc } from './types'
import { uid } from './utils'

function makeNode(id: ID, type: KNode['type'], title: string, parentId: ID | null, metaOverrides?: Partial<DocMeta>): KNode {
  return {
    id, type, title, parentId, childIds: [],
    expanded: type === 'folder',
    meta: {
      label: type === 'scene' ? 'scene' : 'none',
      status: 'todo', synopsis: '', target: 0,
      includeInCompile: type !== 'folder',
      ...metaOverrides,
    },
    ext: {},
  }
}

const TITLE_EXT = /\.(md|markdown|mdown|txt|text)$/i

export function buildProjectFromDocs(title: string, location: string, inputs: ImportDoc[]): Project {
  const id = uid('proj')
  const now = new Date().toISOString()
  const nodes: Record<ID, KNode> = {}
  const docs: Project['docs'] = {}
  const rootIds: ID[] = []
  const trashId = uid('trash')
  nodes[trashId] = makeNode(trashId, 'folder', 'Trash', null, { includeInCompile: false })

  // Cache dir path → folder node id, creating parents on demand.
  const folderIds = new Map<string, ID>()
  const ensureFolder = (dirPath: string): ID | null => {
    if (dirPath === '') return null
    const cached = folderIds.get(dirPath)
    if (cached) return cached
    const parts = dirPath.split('/')
    const name = parts[parts.length - 1]
    const parentId = ensureFolder(parts.slice(0, -1).join('/'))
    const fid = uid('folder')
    nodes[fid] = makeNode(fid, 'folder', name, parentId)
    if (parentId) nodes[parentId].childIds.push(fid)
    else rootIds.push(fid)
    folderIds.set(dirPath, fid)
    return fid
  }

  // Stable order: sort by normalized path so the binder mirrors the source tree.
  const sorted = [...inputs]
    .map((d) => ({ ...d, path: d.path.replace(/\\/g, '/').replace(/^\/+/, '') }))
    .filter((d) => d.path)
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))

  for (const doc of sorted) {
    const segs = doc.path.split('/')
    const file = segs.pop() as string
    const parentId = ensureFolder(segs.join('/'))
    const did = uid('document')
    const docTitle = file.replace(TITLE_EXT, '') || 'Untitled'
    nodes[did] = makeNode(did, 'document', docTitle, parentId)
    docs[did] = { content: doc.content, snapshots: [] }
    if (parentId) nodes[parentId].childIds.push(did)
    else rootIds.push(did)
  }

  rootIds.push(trashId)

  return {
    schemaVersion: 1,
    id,
    title,
    created: now,
    modified: now,
    rootIds,
    trashId,
    nodes,
    docs,
    settings: { location, template: 'blank' },
  }
}
