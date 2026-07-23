import { describe, it, expect, vi } from 'vitest'
import { executeTool, type AgentToolContext } from './agentTools'
import type { Project, KNode, DocBody, ID } from '@shared/types'

function node(id: ID, type: KNode['type'], title: string, parentId: ID | null, childIds: ID[] = []): KNode {
  return { id, type, title, parentId, childIds, expanded: false,
    meta: { label: 'none', status: 'todo', synopsis: '', target: 0, includeInCompile: type !== 'folder' }, ext: {} }
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
  return { schemaVersion: 1, id: 'p', title: 'T', created: '', modified: '',
    rootIds: ['part', 'loose', 'trash'], trashId: 'trash', nodes, docs, settings: { location: '' } } as Project
}

function ctx(p: Project): AgentToolContext {
  return { project: p, appendNote: vi.fn(), createDocument: vi.fn(async () => {}), proposeEdit: vi.fn() }
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
    const changed = await executeTool('propose_edit', { document: 'Chapter 1', new_text: 'A wholly new line.' }, c)
    expect(c.proposeEdit).toHaveBeenCalledTimes(1)
    expect(changed).toMatch(/Queued an edit/)
    const same = await executeTool('propose_edit', { document: 'Chapter 1', new_text: 'Reiko opened the shutter at dawn.' }, c)
    expect(same).toMatch(/identical/)
    expect(c.proposeEdit).toHaveBeenCalledTimes(1)
  })

  it('create_document forwards title/parent/content', async () => {
    const c = ctx(project())
    await executeTool('create_document', { title: 'Chapter 2', parent: 'Part One', content: 'hi' }, c)
    expect(c.createDocument).toHaveBeenCalledWith('Chapter 2', 'Part One', 'hi')
  })
})
