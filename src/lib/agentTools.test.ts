import { describe, it, expect, vi } from 'vitest'
import { executeTool, toolLabel, type AgentToolContext } from './agentTools'
import type { Project, KNode, DocBody, ID } from '@shared/types'

function node(id: ID, type: KNode['type'], title: string, parentId: ID | null, childIds: ID[] = []): KNode {
  return { id, type, title, parentId, childIds, expanded: false,
    meta: { label: 'none', status: 'todo', synopsis: '', target: 0, includeInCompile: type !== 'folder' }, ext: {}, rev: 1, modified: '2024-01-01T00:00:00.000Z' }
}

function project(): Project {
  const nodes: Record<ID, KNode> = {
    part: node('part', 'folder', 'Part One', null, ['ch1']),
    ch1: node('ch1', 'document', 'Chapter 1', 'part'),
    loose: node('loose', 'document', 'Prologue', null),
    trash: node('trash', 'folder', 'Trash', null),
  }
  const docs: Record<ID, DocBody> = {
    ch1: { content: 'Reiko opened the shutter at dawn.', snapshots: [] },
    loose: { content: 'Before everything, there was the harbor.', snapshots: [] },
  }
  return { schemaVersion: 2, id: 'p', title: 'T', created: '', modified: '',
    rootIds: ['part', 'loose', 'trash'], trashId: 'trash', nodes, docs, settings: { location: '' } } as Project
}

function ctx(p: Project): AgentToolContext {
  return { project: p, appendNote: vi.fn(), createNode: vi.fn(async () => {}), proposeEdit: vi.fn() }
}

describe('executeTool', () => {
  it('list_documents renders the outline', async () => {
    const out = await executeTool('list_documents', {}, ctx(project()))
    expect(out).toContain('Part One')
    expect(out).toContain('Chapter 1')
  })

  it('get_document returns content, or guides when not found', async () => {
    expect(await executeTool('get_document', { title: 'Chapter 1' }, ctx(project()))).toContain('Reiko')
    expect(await executeTool('get_document', { title: 'Nope' }, ctx(project()))).toMatch(/No document titled/)
  })

  it('remember forwards the note to appendNote', async () => {
    const c = ctx(project())
    await executeTool('remember', { note: 'Reiko fears the sea' }, c)
    expect(c.appendNote).toHaveBeenCalledWith('Reiko fears the sea')
  })

  it('propose_edit queues a review only when the text actually changes', async () => {
    const c = ctx(project())
    const changed = await executeTool('propose_edit', { title: 'Chapter 1', new_text: 'A wholly new line.' }, c)
    expect(c.proposeEdit).toHaveBeenCalledTimes(1)
    expect(changed).toMatch(/Queued an edit/)
    const same = await executeTool('propose_edit', { title: 'Chapter 1', new_text: 'Reiko opened the shutter at dawn.' }, c)
    expect(same).toMatch(/identical/)
    expect(c.proposeEdit).toHaveBeenCalledTimes(1)
  })

  it('propose_edit takes the same `title` every other tool takes', async () => {
    // This was the odd one out: every other tool names a document title
    // `title`, propose_edit wanted `document`. A model that had just called
    // get_document({title}) sent propose_edit({title}) and got
    // `No document titled "undefined"` — one wasted round trip, every time it
    // guessed the consistent name.
    const c = ctx(project())
    const out = await executeTool('propose_edit', { title: 'Chapter 1', new_text: 'Fresh prose.' }, c)
    expect(out).toMatch(/Queued an edit/)
  })

  it('still answers to the old `document` key, so saved chats replay', async () => {
    const c = ctx(project())
    const out = await executeTool('propose_edit', { document: 'Chapter 1', new_text: 'Fresh prose.' }, c)
    expect(out).toMatch(/Queued an edit/)
  })

  it('names the document it could not find, instead of "undefined"', async () => {
    const c = ctx(project())
    const out = await executeTool('propose_edit', { title: 'Nowhere', new_text: 'x' }, c)
    expect(out).toContain('"Nowhere"')
    expect(out).not.toContain('undefined')
  })

  it('labels the tool use under either key', () => {
    expect(toolLabel('propose_edit', { title: 'Chapter 1' })).toContain('"Chapter 1"')
    expect(toolLabel('propose_edit', { document: 'Chapter 1' })).toContain('"Chapter 1"')
  })

  it('create_document resolves the parent folder to its id', async () => {
    const c = ctx(project())
    const out = await executeTool('create_document', { title: 'Chapter 2', parent: 'Part One', content: 'hi' }, c)
    expect(c.createNode).toHaveBeenCalledWith('document', 'Chapter 2', 'part', 'hi')
    expect(out).toMatch(/under "Part One"/)
  })

  it('create_document reports an unknown parent instead of silently using the root', async () => {
    const c = ctx(project())
    const out = await executeTool('create_document', { title: 'Ch 9', parent: 'Nonexistent Part' }, c)
    expect(c.createNode).not.toHaveBeenCalled()
    expect(out).toMatch(/No folder titled "Nonexistent Part"/)
    expect(out).toContain('"Part One"')          // lists what does exist
    expect(out).toMatch(/create_folder/)          // and says how to fix it
  })

  it('create_document with no parent says so explicitly', async () => {
    const c = ctx(project())
    const out = await executeTool('create_document', { title: 'Loose Note' }, c)
    expect(c.createNode).toHaveBeenCalledWith('document', 'Loose Note', null, '')
    expect(out).toMatch(/at the top level/)
  })

  it('create_folder makes a folder, not a document', async () => {
    const c = ctx(project())
    const out = await executeTool('create_folder', { title: 'Part Two' }, c)
    expect(c.createNode).toHaveBeenCalledWith('folder', 'Part Two', null, '')
    expect(out).toMatch(/Created folder "Part Two"/)
  })

  it('create_folder can nest under an existing folder', async () => {
    const c = ctx(project())
    await executeTool('create_folder', { title: 'Sub', parent: 'Part One' }, c)
    expect(c.createNode).toHaveBeenCalledWith('folder', 'Sub', 'part', '')
  })

  it('a blank title is refused for both', async () => {
    const c = ctx(project())
    expect(await executeTool('create_document', { title: '  ' }, c)).toMatch(/title is required/)
    expect(await executeTool('create_folder', { title: '' }, c)).toMatch(/title is required/)
    expect(c.createNode).not.toHaveBeenCalled()
  })
})
