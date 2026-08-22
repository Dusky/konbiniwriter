import { describe, it, expect } from 'vitest'
import { buildProjectFromTemplate } from './templates'
import type { TemplateId } from './types'

const ALL: TemplateId[] = ['blank', 'novel', 'screenplay', 'nonfiction']

describe('buildProjectFromTemplate', () => {
  // The builder had no test at all, which is how it kept shipping a demo novel
  // to every author who clicked "New Project". These are the structural
  // guarantees every backend (FSA, OPFS, Node) then persists to disk.
  it.each(ALL)('%s builds a structurally valid project', (template) => {
    const p = buildProjectFromTemplate('T', template, '/tmp/T.konbini')

    expect(p.schemaVersion).toBe(2)
    expect(p.title).toBe('T')
    expect(p.settings).toEqual({ location: '/tmp/T.konbini', template })

    // Trash always exists and is always reachable from the root.
    expect(p.trashId).toBeTruthy()
    expect(p.nodes[p.trashId!]).toBeTruthy()
    expect(p.rootIds).toContain(p.trashId)

    // Every root is real and parentless.
    for (const id of p.rootIds) {
      expect(p.nodes[id], `root ${id}`).toBeTruthy()
      expect(p.nodes[id].parentId).toBeNull()
    }

    // The tree agrees with itself in both directions, and nothing is orphaned.
    const seen = new Set<string>()
    const walk = (id: string) => {
      expect(seen.has(id), `${id} appears twice`).toBe(false)
      seen.add(id)
      for (const cid of p.nodes[id].childIds) {
        expect(p.nodes[cid], `child ${cid} of ${id}`).toBeTruthy()
        expect(p.nodes[cid].parentId).toBe(id)
        walk(cid)
      }
    }
    p.rootIds.forEach(walk)
    expect(seen.size).toBe(Object.keys(p.nodes).length)

    // docs and nodes correspond exactly: every non-folder has a body, no folder
    // does, and no body belongs to a node that isn't there.
    for (const [id, node] of Object.entries(p.nodes)) {
      expect(id in p.docs, `${node.title} (${node.type}) doc entry`).toBe(node.type !== 'folder')
    }
    for (const id of Object.keys(p.docs)) expect(p.nodes[id]).toBeTruthy()
  })

  it('gives a new project no prose of its own', () => {
    // A template supplies structure. It must never hand the author sentences
    // they then have to delete — `novel` used to ship an entire demo manuscript
    // ("Midnight Aisle") and it was the default selection.
    for (const template of ALL) {
      const p = buildProjectFromTemplate('T', template, '/tmp/T.konbini')
      for (const [id, doc] of Object.entries(p.docs)) {
        expect(doc.content, `${p.nodes[id].title} in ${template}`).toBe('')
        expect(doc.snapshots).toEqual([])
      }
    }
  })

  it('novel is a three-act skeleton with somewhere to put cast and research', () => {
    const p = buildProjectFromTemplate('T', 'novel', '/tmp/T.konbini')
    const titles = (ids: string[]) => ids.map((id) => p.nodes[id].title)

    expect(titles(p.rootIds)).toEqual(['Manuscript', 'Characters', 'Research', 'Trash'])

    const manuscript = p.rootIds.map((id) => p.nodes[id]).find((n) => n.title === 'Manuscript')!
    expect(titles(manuscript.childIds)).toEqual(['Part One', 'Part Two', 'Part Three'])

    // Each part carries a chapter carrying one empty scene — enough shape to
    // start typing into, and nothing that has to be cleared out first.
    manuscript.childIds.forEach((partId, i) => {
      const chapter = p.nodes[p.nodes[partId].childIds[0]]
      expect(chapter.title).toBe(`Chapter ${i + 1}`)
      expect(chapter.meta.label).toBe('chapter')
      const scene = p.nodes[chapter.childIds[0]]
      expect(scene.type).toBe('scene')
      expect(scene.meta.target).toBeGreaterThan(0)
    })

    // The folder synopses are how a template explains itself without writing
    // prose, so they are load-bearing rather than decoration.
    for (const id of p.rootIds) {
      if (id === p.trashId) continue
      expect(p.nodes[id].meta.synopsis.length).toBeGreaterThan(0)
    }
  })

  it('gives every project a unique id', () => {
    const a = buildProjectFromTemplate('A', 'novel', '/tmp/A')
    const b = buildProjectFromTemplate('B', 'novel', '/tmp/B')
    expect(a.id).not.toBe(b.id)
    // Node ids must not collide across projects either — two projects open in
    // one session share nothing (invariant 6: ids are stable and never reused).
    expect(Object.keys(a.nodes).some((id) => id in b.nodes && id !== a.trashId)).toBe(false)
  })
})
