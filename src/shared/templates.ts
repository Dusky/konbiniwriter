import type { Project, KNode, DocBody, DocMeta, TemplateId, ID } from './types'
import { uid } from './utils'

function makeNode(
  id: ID,
  type: KNode['type'],
  title: string,
  parentId: ID | null,
  metaOverrides?: Partial<DocMeta>
): KNode {
  return {
    id,
    type,
    title,
    parentId,
    childIds: [],
    expanded: type === 'folder',
    meta: {
      label: type === 'scene' ? 'scene' : 'none',
      status: 'todo',
      synopsis: '',
      target: 0,
      includeInCompile: type !== 'folder',
      ...metaOverrides,
    },
    ext: {},
    rev: 1,
    modified: new Date().toISOString(),
  }
}

export function buildProjectFromTemplate(
  title: string,
  template: TemplateId,
  location: string
): Project {
  const id = uid('proj')
  const now = new Date().toISOString()
  const nodes: Record<ID, KNode> = {}
  const docs: Record<ID, DocBody> = {}
  let rootIds: ID[] = []
  const trashId = uid('trash')

  const addNode = (n: KNode, content = '') => {
    nodes[n.id] = n
    if (n.type !== 'folder') docs[n.id] = { content, snapshots: [] }
  }

  const link = (parentId: ID, childIds: ID[]) => {
    nodes[parentId].childIds = childIds
    childIds.forEach((cid) => { nodes[cid].parentId = parentId })
  }

  // Trash is always present
  const trash = makeNode(trashId, 'folder', 'Trash', null, { includeInCompile: false })
  nodes[trashId] = trash

  if (template === 'blank') {
    const mId = uid('folder')
    const dId = uid('document')
    const m = makeNode(mId, 'folder', 'Manuscript', null, { status: 'inprogress' })
    const d = makeNode(dId, 'document', 'Untitled', mId)
    addNode(m); addNode(d)
    link(mId, [dId])
    rootIds = [mId, trashId]

  } else if (template === 'novel') {
    // Structure only — no prose. A new novel project is *your* novel; the
    // template's job is to give it a shape and then get out of the way. The
    // folder synopses are the one place a template can talk to the author
    // without inventing sentences for them.
    const mId = uid('folder')
    const charsId = uid('folder')
    const resId = uid('folder')

    addNode(makeNode(mId, 'folder', 'Manuscript', null, {
      status: 'inprogress',
      synopsis: 'The book itself. Everything under here compiles; everything outside it does not.',
    }))

    const partIds: ID[] = []
    const PARTS: [string, string][] = [
      ['Part One',   'Setup — the world as it is, and the thing that breaks it.'],
      ['Part Two',   'Confrontation — what it costs to want the thing.'],
      ['Part Three', 'Resolution — what it turns out to have been about.'],
    ]
    PARTS.forEach(([title, synopsis], i) => {
      const pId = uid('folder')
      const cId = uid('folder')
      const sId = uid('scene')
      addNode(makeNode(pId, 'folder', title, mId, { status: 'todo', synopsis }))
      addNode(makeNode(cId, 'folder', `Chapter ${i + 1}`, pId, { label: 'chapter', status: 'todo' }))
      addNode(makeNode(sId, 'scene', 'Scene 1', cId, { label: 'scene', status: 'todo', target: 1500 }))
      link(cId, [sId]); link(pId, [cId])
      partIds.push(pId)
    })
    link(mId, partIds)

    addNode(makeNode(charsId, 'folder', 'Characters', null, {
      synopsis: 'Cast — one document per character. Write [[Their Name]] in your prose and it links here.',
    }))
    addNode(makeNode(resId, 'folder', 'Research', null, {
      synopsis: 'Notes, references, anything you want at hand but not in the book.',
    }))

    rootIds = [mId, charsId, resId, trashId]

  } else if (template === 'screenplay') {
    const scriptId = uid('folder')
    const act1Id = uid('folder')
    const sc1Id = uid('scene')
    const script = makeNode(scriptId, 'folder', 'Script', null, { status: 'inprogress' })
    const act1 = makeNode(act1Id, 'folder', 'Act One', scriptId, { label: 'chapter', status: 'todo' })
    const sc1 = makeNode(sc1Id, 'scene', 'Scene 1', act1Id, { label: 'scene', status: 'todo' })
    addNode(script); addNode(act1); addNode(sc1)
    link(act1Id, [sc1Id]); link(scriptId, [act1Id])
    rootIds = [scriptId, trashId]

  } else {
    // nonfiction
    const bookId = uid('folder')
    const ch1Id = uid('folder')
    const sec1Id = uid('document')
    const book = makeNode(bookId, 'folder', 'Book', null, { status: 'inprogress' })
    const ch1 = makeNode(ch1Id, 'folder', 'Chapter 1', bookId, { label: 'chapter', status: 'todo' })
    const sec1 = makeNode(sec1Id, 'document', 'Introduction', ch1Id, { status: 'todo' })
    addNode(book); addNode(ch1); addNode(sec1)
    link(ch1Id, [sec1Id]); link(bookId, [ch1Id])
    rootIds = [bookId, trashId]
  }

  return {
    schemaVersion: 2,
    id,
    title,
    created: now,
    modified: now,
    rootIds,
    trashId,
    nodes,
    docs,
    settings: { location, template },
  }
}
