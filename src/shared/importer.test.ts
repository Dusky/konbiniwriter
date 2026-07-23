import { describe, it, expect } from 'vitest'
import { buildProjectFromDocs } from './importer'

describe('buildProjectFromDocs', () => {
  it('builds a folder tree from paths with one document per file', () => {
    const p = buildProjectFromDocs('My Novel', '/tmp/x', [
      { path: 'Part 1/ch2.md', content: 'two' },
      { path: 'Part 1/ch1.md', content: 'one' },
      { path: 'intro.txt', content: 'hi' },
    ])
    const byTitle = (t: string) => Object.values(p.nodes).find((n) => n.title === t)
    const part1 = byTitle('Part 1')!
    expect(part1.type).toBe('folder')
    expect(part1.parentId).toBeNull()
    // ch1 and ch2 live under Part 1, in numeric order
    const kids = part1.childIds.map((id) => p.nodes[id].title)
    expect(kids).toEqual(['ch1', 'ch2'])
    // intro is a root-level document; extension stripped from the title
    const intro = byTitle('intro')!
    expect(intro.type).toBe('document')
    expect(intro.parentId).toBeNull()
    expect(p.docs[intro.id].content).toBe('hi')
    // content mapped to the right node
    const ch1 = byTitle('ch1')!
    expect(p.docs[ch1.id].content).toBe('one')
  })

  it('always includes a Trash folder, listed last at root', () => {
    const p = buildProjectFromDocs('X', '', [{ path: 'a.md', content: '' }])
    const trashId = p.trashId as string
    expect(p.nodes[trashId].title).toBe('Trash')
    expect(p.rootIds[p.rootIds.length - 1]).toBe(trashId)
  })

  it('reuses a folder across multiple files rather than duplicating it', () => {
    const p = buildProjectFromDocs('X', '', [
      { path: 'A/one.md', content: '' },
      { path: 'A/two.md', content: '' },
    ])
    const folders = Object.values(p.nodes).filter((n) => n.type === 'folder' && n.title === 'A')
    expect(folders).toHaveLength(1)
    expect(folders[0].childIds).toHaveLength(2)
  })
})
