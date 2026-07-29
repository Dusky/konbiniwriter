// The project layer, against a real filesystem.
//
// This is the one backend that can be tested with real bytes and no mocks —
// the browser two are driven by `scripts/smoke.mjs` in a real browser instead.
// Everything asserted here is the *contract* all three share, so a change that
// breaks one and not the others shows up as a disagreement between this file
// and the smoke test rather than as a bug report.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { NodeProjectService } from './NodeProjectService'
import type { Project } from '../src/shared/types'

let tmp: string
let svc: NodeProjectService
let project: Project

const bundle = () => path.join(tmp, 'Book.konbini')
const read = (rel: string) => fs.readFile(path.join(bundle(), rel), 'utf8')
const exists = async (rel: string) => !!(await fs.stat(path.join(bundle(), rel)).catch(() => null))
const firstScene = (p: Project) =>
  Object.values(p.nodes).find((n) => n.type !== 'folder' && n.id !== p.trashId)!.id

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'konbini-test-'))
  svc = new NodeProjectService()
  // `location` is the parent directory; the service appends `<title>.konbini`.
  project = await svc.create({ title: 'Book', template: 'novel', location: tmp })
})
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

describe('create', () => {
  it('lays down a bundle a human could read', async () => {
    expect(await exists('project.json')).toBe(true)
    expect(await exists('docs')).toBe(true)
    expect(JSON.parse(await read('project.json')).title).toBe('Book')
  })

  it('writes no empty sidecars — absence means "none yet", and open() knows it', async () => {
    // `adoptSidecars` treats a missing file as an empty collection on purpose,
    // so a fresh bundle stays free of files that say nothing.
    for (const f of ['codex.json', 'debt.json', 'comments.json']) {
      expect(await exists(f)).toBe(false)
    }
    const reopened = await new NodeProjectService().open(bundle())
    expect(reopened.settings.codex).toEqual([])
    expect(reopened.settings.debt).toEqual([])
    expect(reopened.settings.comments).toEqual([])
  })

  it('creates a sidecar the first time there is something to put in it', async () => {
    await svc.saveDebt(project.id, [])
    expect(await exists('debt.json')).toBe(true)
  })

  it('gives the project a trash folder from the start', () => {
    expect(project.nodes[project.trashId]).toBeDefined()
  })
})

describe('writeDoc / readDoc', () => {
  it('writes prose as plain Markdown at docs/<id>.md', async () => {
    const id = firstScene(project)
    await svc.writeDoc(project.id, id, '# Scene\n\nShe paid the toll.')
    expect(await read(`docs/${id}.md`)).toBe('# Scene\n\nShe paid the toll.')
  })

  it('reads back exactly what was written', async () => {
    const id = firstScene(project)
    await svc.writeDoc(project.id, id, 'Round trip.')
    expect(await svc.readDoc(project.id, id)).toBe('Round trip.')
  })

  it('preserves content a naive round trip would mangle', async () => {
    const id = firstScene(project)
    const tricky = 'Em—dash, "curly quotes", éè, emoji 🕯, tab\there,\r\nCRLF, trailing spaces   \nend'
    await svc.writeDoc(project.id, id, tricky)
    expect(await svc.readDoc(project.id, id)).toBe(tricky)
  })

  it('returns empty for a document with no file yet, rather than throwing', async () => {
    expect(await svc.readDoc(project.id, 'never-written')).toBe('')
  })

  it('overwrites rather than appending', async () => {
    const id = firstScene(project)
    await svc.writeDoc(project.id, id, 'first')
    await svc.writeDoc(project.id, id, 'second')
    expect(await svc.readDoc(project.id, id)).toBe('second')
  })
})

describe('open', () => {
  it('reopens a bundle with its prose intact — the promise the format makes', async () => {
    const id = firstScene(project)
    await svc.writeDoc(project.id, id, 'Survives a close.')
    await svc.close(project.id)
    const reopened = await new NodeProjectService().open(bundle())
    expect(reopened.docs[id]?.content).toBe('Survives a close.')
    expect(reopened.title).toBe('Book')
  })

  it('folds the sidecars back onto settings', async () => {
    await svc.saveCodex(project.id, [{
      id: 'e1', name: 'Mira', aliases: [], category: 'character', summary: '',
      facts: [], createdAt: '', modifiedAt: '', aiGenerated: false,
    }])
    await svc.close(project.id)
    const reopened = await new NodeProjectService().open(bundle())
    expect((reopened.settings.codex as Array<{ name: string }>)[0]?.name).toBe('Mira')
  })

  it('never persists the one-shot _newId marker', async () => {
    // A stale marker made every AI-created document resolve to the first node
    // of the session, which is how AI drafts arrived blank.
    await svc.mutateNode(project.id, { type: 'create', parentId: null, nodeType: 'document' })
    await svc.close(project.id)
    const manifest = JSON.parse(await read('project.json'))
    const marked = Object.values(manifest.nodes as Record<string, { ext: Record<string, unknown> }>)
      .filter((n) => n.ext?._newId !== undefined)
    expect(marked).toEqual([])
  })

  it('keeps prose out of the manifest — it lives in docs/*.md', async () => {
    const id = firstScene(project)
    await svc.writeDoc(project.id, id, 'UNIQUE_PROSE_MARKER')
    await svc.close(project.id)
    expect(await read('project.json')).not.toContain('UNIQUE_PROSE_MARKER')
  })
})

describe('mutateNode', () => {
  it('marks exactly one node as new per create', async () => {
    const r = await svc.mutateNode(project.id, { type: 'create', parentId: null, nodeType: 'document' })
    const marked = Object.values(r.nodes).filter((n) => n.ext._newId !== undefined)
    expect(marked).toHaveLength(1)
  })

  it('never reuses an id across rapid creates', async () => {
    const ids: string[] = []
    for (let i = 0; i < 20; i++) {
      const r = await svc.mutateNode(project.id, { type: 'create', parentId: null, nodeType: 'document' })
      ids.push(Object.values(r.nodes).find((n) => n.ext._newId !== undefined)!.id)
    }
    expect(new Set(ids).size).toBe(20)
  })

  it('renames without touching the prose', async () => {
    const id = firstScene(project)
    await svc.writeDoc(project.id, id, 'body')
    const r = await svc.mutateNode(project.id, { type: 'rename', id, title: 'Renamed' })
    expect(r.nodes[id]?.title).toBe('Renamed')
    expect(await svc.readDoc(project.id, id)).toBe('body')
  })

  it('trash moves a node without destroying it', async () => {
    const id = firstScene(project)
    const r = await svc.mutateNode(project.id, { type: 'trash', id })
    expect(r.nodes[id]).toBeDefined()
    expect(r.nodes[id]?.parentId).toBe(project.trashId)
  })

  it('a moved node keeps its content', async () => {
    const id = firstScene(project)
    await svc.writeDoc(project.id, id, 'moved but intact')
    await svc.mutateNode(project.id, { type: 'move', id, newParentId: null, atIndex: 0 })
    expect(await svc.readDoc(project.id, id)).toBe('moved but intact')
  })
})

describe('snapshots', () => {
  it('captures the document as it stands', async () => {
    const id = firstScene(project)
    await svc.writeDoc(project.id, id, 'version one')
    const snap = await svc.takeSnapshot(project.id, id, 'first')
    expect(snap.content).toBe('version one')
    expect(snap.title).toBe('first')
  })

  it('restores the old text and hands it back', async () => {
    const id = firstScene(project)
    await svc.writeDoc(project.id, id, 'version one')
    const snap = await svc.takeSnapshot(project.id, id)
    await svc.writeDoc(project.id, id, 'version two')
    const restored = await svc.restoreSnapshot(project.id, id, snap.id)
    expect(restored.content).toBe('version one')
    expect(await svc.readDoc(project.id, id)).toBe('version one')
  })

  it('records its kind, so retention can tell auto from manual', async () => {
    const id = firstScene(project)
    await svc.writeDoc(project.id, id, 'x')
    expect((await svc.takeSnapshot(project.id, id, '', 'auto')).kind).toBe('auto')
    expect((await svc.takeSnapshot(project.id, id, '', 'manual')).kind).toBe('manual')
  })

  it('lists newest first', async () => {
    const id = firstScene(project)
    await svc.writeDoc(project.id, id, 'x')
    const a = await svc.takeSnapshot(project.id, id, 'older')
    const b = await svc.takeSnapshot(project.id, id, 'newer')
    const list = await svc.listSnapshots(project.id, id)
    expect(list.map((s) => s.id).slice(0, 2)).toEqual([b.id, a.id])
  })

  it('deletes one without disturbing the others', async () => {
    const id = firstScene(project)
    await svc.writeDoc(project.id, id, 'x')
    const a = await svc.takeSnapshot(project.id, id, 'keep')
    const b = await svc.takeSnapshot(project.id, id, 'drop')
    await svc.deleteSnapshot(project.id, id, b.id)
    expect((await svc.listSnapshots(project.id, id)).map((s) => s.id)).toEqual([a.id])
  })

  it('returns an empty list for a document that has none', async () => {
    expect(await svc.listSnapshots(project.id, firstScene(project))).toEqual([])
  })
})

describe('aux files', () => {
  it('round-trips a named cache', async () => {
    await svc.writeAux(project.id, 'chat.json', '{"a":1}')
    expect(await svc.readAux(project.id, 'chat.json')).toBe('{"a":1}')
  })

  it('returns null for one that was never written', async () => {
    expect(await svc.readAux(project.id, 'nothing.json')).toBeNull()
  })

  it('removes one', async () => {
    await svc.writeAux(project.id, 'chat.json', 'x')
    await svc.removeAux(project.id, 'chat.json')
    expect(await svc.readAux(project.id, 'chat.json')).toBeNull()
  })

  it('refuses a name that would escape the bundle', async () => {
    // aux names come from feature code, but a path traversal here would write
    // anywhere on the author's disk.
    await expect(svc.writeAux(project.id, '../escape.json', 'x')).rejects.toThrow()
    await expect(svc.readAux(project.id, '../../etc/passwd')).rejects.toThrow()
  })
})

describe('settings', () => {
  it('merges a patch instead of replacing the whole object', async () => {
    await svc.saveSettings(project.id, { author: 'Jane' })
    await svc.saveSettings(project.id, { wordTarget: 50_000 })
    await svc.close(project.id)
    const reopened = await new NodeProjectService().open(bundle())
    expect(reopened.settings.author).toBe('Jane')
    expect(reopened.settings.wordTarget).toBe(50_000)
  })
})

describe('compile', () => {
  const included = (p: Project) =>
    Object.values(p.nodes).filter((n) => n.type !== 'folder' && n.id !== p.trashId).map((n) => n.id)

  it('joins the manuscript into one Markdown file', async () => {
    const id = firstScene(project)
    await svc.writeDoc(project.id, id, 'Scene body.')
    const out = await svc.compile(project.id, project.rootIds[0]!, included(project), 'markdown')
    expect(new TextDecoder().decode(out.blob)).toContain('Scene body.')
    expect(out.filename).toMatch(/\.md$/)
  })

  it('produces a non-empty docx', async () => {
    const id = firstScene(project)
    await svc.writeDoc(project.id, id, 'Scene body.')
    const out = await svc.compile(project.id, project.rootIds[0]!, included(project), 'docx')
    expect(out.blob.byteLength).toBeGreaterThan(1000)
    expect(out.filename).toMatch(/\.docx$/)
  })

  it('leaves out what the author excluded', async () => {
    const id = firstScene(project)
    await svc.writeDoc(project.id, id, 'EXCLUDED_MARKER')
    const out = await svc.compile(project.id, project.rootIds[0]!, [], 'markdown')
    expect(new TextDecoder().decode(out.blob)).not.toContain('EXCLUDED_MARKER')
  })
})
