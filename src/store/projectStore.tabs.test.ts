import { describe, it, expect, beforeEach } from 'vitest'
import { useProjectStore } from './projectStore'
import type { Project, KNode, ID } from '@shared/types'

function node(id: ID, type: KNode['type'], title: string): KNode {
  return { id, type, title, parentId: null, childIds: [], expanded: false,
    meta: { label: 'none', status: 'todo', synopsis: '', target: 0, includeInCompile: type !== 'folder' }, ext: {} }
}

function project(): Project {
  const nodes: Record<ID, KNode> = {
    a: node('a', 'document', 'A'),
    b: node('b', 'document', 'B'),
    c: node('c', 'document', 'C'),
    f: node('f', 'folder', 'Folder'),
  }
  return { schemaVersion: 1, id: 'p', title: 'T', created: '', modified: '',
    rootIds: ['a', 'b', 'c', 'f'], trashId: 'trash', nodes,
    docs: { a: { content: '', snapshots: [] }, b: { content: '', snapshots: [] }, c: { content: '', snapshots: [] } },
    settings: { location: '' } } as Project
}

describe('projectStore open tabs', () => {
  beforeEach(() => { useProjectStore.getState().loadProject(project()) })

  it('selecting a document opens it as a tab and activates it', () => {
    const s = useProjectStore.getState()
    s.selectNode('a'); s.selectNode('b')
    const st = useProjectStore.getState()
    expect(st.openTabs).toEqual(['a', 'b'])
    expect(st.selectedId).toBe('b')
  })

  it('re-selecting an open document does not duplicate its tab', () => {
    const s = useProjectStore.getState()
    s.selectNode('a'); s.selectNode('b'); s.selectNode('a')
    expect(useProjectStore.getState().openTabs).toEqual(['a', 'b'])
    expect(useProjectStore.getState().selectedId).toBe('a')
  })

  it('folders never get a tab', () => {
    useProjectStore.getState().selectNode('f')
    expect(useProjectStore.getState().openTabs).toEqual([])
  })

  it('closing the active tab activates its neighbour', () => {
    const s = useProjectStore.getState()
    s.selectNode('a'); s.selectNode('b'); s.selectNode('c')
    useProjectStore.getState().closeTab('c') // active → left neighbour
    expect(useProjectStore.getState().openTabs).toEqual(['a', 'b'])
    expect(useProjectStore.getState().selectedId).toBe('b')
  })

  it('closing a background tab keeps the active one', () => {
    const s = useProjectStore.getState()
    s.selectNode('a'); s.selectNode('b')
    useProjectStore.getState().closeTab('a')
    expect(useProjectStore.getState().openTabs).toEqual(['b'])
    expect(useProjectStore.getState().selectedId).toBe('b')
  })

  it('loadProject resets open tabs', () => {
    useProjectStore.getState().selectNode('a')
    useProjectStore.getState().loadProject(project())
    expect(useProjectStore.getState().openTabs).toEqual([])
  })
})
