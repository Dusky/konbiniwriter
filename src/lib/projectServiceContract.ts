// The project layer's contract, stated once and run against every backend.
//
// Konbini has three storage backends behind `window.api` — `NodeProjectService`
// (Electron, real paths), `BrowserProjectService` (Chrome/Edge, File System
// Access) and `OPFSProjectService` (Firefox/Safari) — and the renderer never
// knows which one is active. That only holds if they agree, and for a long time
// only the Node one was tested: a change that broke the FSA backend and not the
// others had nothing to fail.
//
// So this file holds the assertions and nothing else. Each backend's test file
// supplies a `Harness` — how to make a service, where the bytes land, how to
// re-open the same bundle cold — and gets the whole suite. A divergence now
// fails in the backend that diverged, by name.
//
// Not a test file itself (no `.test.` in the name), so vitest only runs it
// through the three that call it.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type {
  Project, KNode, DocBody, NodeOp, Snapshot, ID, ImportDoc,
  CompileFormat, CompileResult, ProjectSettings, CodexEntry, DebtItem,
} from '@shared/types'
import type { Comment } from '@shared/comments'

/**
 * The shared surface. Every backend implements exactly this; anything a single
 * backend adds (FSA's handle permissions, OPFS's location strings) is tested in
 * that backend's own file.
 */
export interface ProjectServiceLike {
  create(opts: { title: string; template: 'blank' | 'novel' | 'screenplay' | 'nonfiction'; location: string }): Promise<Project>
  import(opts: { title: string; location: string; docs: ImportDoc[] }): Promise<Project>
  close(id: string): Promise<void>
  readDoc(projectId: string, nodeId: string): Promise<string>
  writeDoc(projectId: string, nodeId: string, content: string): Promise<void>
  mutateNode(projectId: string, op: NodeOp): Promise<{ rootIds: ID[]; nodes: Record<ID, KNode>; docs: Record<ID, DocBody> }>
  takeSnapshot(projectId: string, nodeId: string, title?: string, kind?: 'manual' | 'auto'): Promise<Snapshot>
  restoreSnapshot(projectId: string, nodeId: string, snapshotId: string): Promise<{ content: string; snapshot: Snapshot }>
  listSnapshots(projectId: string, nodeId: string): Promise<Snapshot[]>
  deleteSnapshot(projectId: string, nodeId: string, snapshotId: string): Promise<void>
  compile(projectId: string, rootId: string, includedIds: string[], format: CompileFormat): Promise<CompileResult>
  saveSettings(projectId: string, patch: Partial<ProjectSettings>): Promise<void>
  saveCodex(projectId: string, entries: CodexEntry[]): Promise<void>
  saveDebt(projectId: string, items: DebtItem[]): Promise<void>
  saveComments(projectId: string, comments: Comment[]): Promise<void>
  readAux(projectId: string, name: string): Promise<string | null>
  writeAux(projectId: string, name: string, content: string): Promise<void>
  removeAux(projectId: string, name: string): Promise<void>
  probe(projectId: string): Promise<Record<string, number>>
}

export interface Harness {
  /** Called first in every test. Wipe storage and any global stubs. */
  reset(): Promise<void>
  /** A brand-new service instance over the same storage — used to reopen cold. */
  service(): ProjectServiceLike
  /** Create the fixture project with this service. */
  create(svc: ProjectServiceLike, title: string): Promise<Project>
  /** Re-read the bundle a fresh service has never seen in memory. */
  reopen(svc: ProjectServiceLike, project: Project): Promise<Project>
  /** A file inside the bundle, by bundle-relative path. null when absent. */
  readRaw(project: Project, rel: string): Promise<string | null>
  /** Whether anything exists at a bundle-relative path (file or directory). */
  existsRaw(project: Project, rel: string): Promise<boolean>
  /**
   * Where a *second* project should be created, as this backend spells it:
   * Node wants a parent directory, FSA a picked-handle key, OPFS anything.
   */
  location: string
  afterEach?(): Promise<void>
}

const firstScene = (p: Project) =>
  Object.values(p.nodes).find((n) => n.type !== 'folder' && n.id !== p.trashId)!.id

export function runProjectServiceContract(backend: string, harness: Harness): void {
  describe(`${backend} · project layer contract`, () => {
    let svc: ProjectServiceLike
    let project: Project

    beforeEach(async () => {
      await harness.reset()
      svc = harness.service()
      project = await harness.create(svc, 'Book')
    })
    afterEach(async () => { await harness.afterEach?.() })

    // A scene the template made but never wrote a file for. Every backend has to
    // treat "no file" as "empty document" rather than an error, because the
    // template only writes `.md` for documents that have content — which, since
    // templates stopped shipping prose, is none of them.
    const scene = () => firstScene(project)

    describe('create', () => {
      it('lays down a bundle a human could read', async () => {
        expect(await harness.existsRaw(project, 'project.json')).toBe(true)
        expect(await harness.existsRaw(project, 'docs')).toBe(true)
        const manifest = await harness.readRaw(project, 'project.json')
        expect(JSON.parse(manifest!).title).toBe('Book')
      })

      it('writes no empty sidecars — absence means "none yet", and open() knows it', async () => {
        // `adoptSidecars` treats a missing file as an empty collection on
        // purpose, so a fresh bundle stays free of files that say nothing.
        for (const f of ['codex.json', 'debt.json', 'comments.json']) {
          expect(await harness.existsRaw(project, f), f).toBe(false)
        }
        const reopened = await harness.reopen(harness.service(), project)
        expect(reopened.settings.codex).toEqual([])
        expect(reopened.settings.debt).toEqual([])
        expect(reopened.settings.comments).toEqual([])
      })

      it('creates a sidecar the first time there is something to put in it', async () => {
        await svc.saveDebt(project.id, [])
        expect(await harness.existsRaw(project, 'debt.json')).toBe(true)
      })

      it('gives the project a trash folder from the start', () => {
        expect(project.nodes[project.trashId!]).toBeDefined()
      })
    })

    describe('writeDoc / readDoc', () => {
      it('writes prose as plain Markdown at docs/<id>.md', async () => {
        await svc.writeDoc(project.id, scene(), '# Scene\n\nShe paid the toll.')
        expect(await harness.readRaw(project, `docs/${scene()}.md`)).toBe('# Scene\n\nShe paid the toll.')
      })

      it('reads back exactly what was written', async () => {
        await svc.writeDoc(project.id, scene(), 'Round trip.')
        expect(await svc.readDoc(project.id, scene())).toBe('Round trip.')
      })

      it('preserves content a naive round trip would mangle', async () => {
        const tricky = 'Em—dash, "curly quotes", éè, emoji 🕯, tab\there,\r\nCRLF, trailing spaces   \nend'
        await svc.writeDoc(project.id, scene(), tricky)
        expect(await svc.readDoc(project.id, scene())).toBe(tricky)
      })

      it('returns empty for a document with no file yet, rather than throwing', async () => {
        expect(await svc.readDoc(project.id, 'never-written')).toBe('')
      })

      it('overwrites rather than appending', async () => {
        await svc.writeDoc(project.id, scene(), 'first')
        await svc.writeDoc(project.id, scene(), 'second')
        expect(await svc.readDoc(project.id, scene())).toBe('second')
      })

      it('can empty a document back out', async () => {
        // Deleting every word is a legitimate edit, and a backend that skipped
        // the write for falsy content would silently keep the old prose.
        await svc.writeDoc(project.id, scene(), 'words')
        await svc.writeDoc(project.id, scene(), '')
        expect(await svc.readDoc(project.id, scene())).toBe('')
      })
    })

    describe('open', () => {
      it('reopens a bundle with its prose intact — the promise the format makes', async () => {
        const id = scene()
        await svc.writeDoc(project.id, id, 'Survives a close.')
        await svc.close(project.id)
        const reopened = await harness.reopen(harness.service(), project)
        expect(reopened.docs[id]?.content).toBe('Survives a close.')
        expect(reopened.title).toBe('Book')
      })

      it('folds the sidecars back onto settings', async () => {
        await svc.saveCodex(project.id, [{
          id: 'e1', name: 'Mira', aliases: [], category: 'character', summary: '',
          facts: [], createdAt: '', modifiedAt: '', aiGenerated: false,
        }])
        await svc.close(project.id)
        const reopened = await harness.reopen(harness.service(), project)
        expect((reopened.settings.codex as Array<{ name: string }>)[0]?.name).toBe('Mira')
      })

      it('never persists the one-shot _newId marker', async () => {
        // A stale marker made every AI-created document resolve to the first
        // node of the session, which is how AI drafts arrived blank.
        await svc.mutateNode(project.id, { type: 'create', parentId: null, nodeType: 'document' })
        await svc.close(project.id)
        const manifest = JSON.parse((await harness.readRaw(project, 'project.json'))!)
        const marked = Object.values(manifest.nodes as Record<string, { ext: Record<string, unknown> }>)
          .filter((n) => n.ext?._newId !== undefined)
        expect(marked).toEqual([])
      })

      it('keeps prose out of the manifest — it lives in docs/*.md', async () => {
        await svc.writeDoc(project.id, scene(), 'UNIQUE_PROSE_MARKER')
        await svc.close(project.id)
        expect(await harness.readRaw(project, 'project.json')).not.toContain('UNIQUE_PROSE_MARKER')
      })

      it('keeps snapshot bodies out of the manifest too', async () => {
        // Snapshot content lives in snapshots/<node>/<id>.md; the manifest holds
        // metadata only. Inlining it would grow project.json without bound.
        await svc.writeDoc(project.id, scene(), 'SNAPSHOT_BODY_MARKER')
        await svc.takeSnapshot(project.id, scene(), 'v1')
        await svc.close(project.id)
        expect(await harness.readRaw(project, 'project.json')).not.toContain('SNAPSHOT_BODY_MARKER')
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
        const id = scene()
        await svc.writeDoc(project.id, id, 'body')
        const r = await svc.mutateNode(project.id, { type: 'rename', id, title: 'Renamed' })
        expect(r.nodes[id]?.title).toBe('Renamed')
        expect(await svc.readDoc(project.id, id)).toBe('body')
      })

      it('trash moves a node without destroying it', async () => {
        const id = scene()
        const r = await svc.mutateNode(project.id, { type: 'trash', id })
        expect(r.nodes[id]).toBeDefined()
        expect(r.nodes[id]?.parentId).toBe(project.trashId)
      })

      it('a moved node keeps its content', async () => {
        const id = scene()
        await svc.writeDoc(project.id, id, 'moved but intact')
        await svc.mutateNode(project.id, { type: 'move', id, newParentId: null, atIndex: 0 })
        expect(await svc.readDoc(project.id, id)).toBe('moved but intact')
      })

      it('a structural change survives a reopen', async () => {
        const r = await svc.mutateNode(project.id, { type: 'create', parentId: null, nodeType: 'document' })
        const created = Object.values(r.nodes).find((n) => n.ext._newId !== undefined)!.id
        await svc.close(project.id)
        const reopened = await harness.reopen(harness.service(), project)
        expect(reopened.nodes[created]).toBeDefined()
      })
    })

    describe('snapshots', () => {
      it('captures the document as it stands', async () => {
        await svc.writeDoc(project.id, scene(), 'version one')
        const snap = await svc.takeSnapshot(project.id, scene(), 'first')
        expect(snap.content).toBe('version one')
        expect(snap.title).toBe('first')
      })

      it('restores the old text and hands it back', async () => {
        const id = scene()
        await svc.writeDoc(project.id, id, 'version one')
        const snap = await svc.takeSnapshot(project.id, id)
        await svc.writeDoc(project.id, id, 'version two')
        const restored = await svc.restoreSnapshot(project.id, id, snap.id)
        expect(restored.content).toBe('version one')
        expect(await svc.readDoc(project.id, id)).toBe('version one')
      })

      it('records its kind, so retention can tell auto from manual', async () => {
        await svc.writeDoc(project.id, scene(), 'x')
        expect((await svc.takeSnapshot(project.id, scene(), '', 'auto')).kind).toBe('auto')
        expect((await svc.takeSnapshot(project.id, scene(), '', 'manual')).kind).toBe('manual')
      })

      it('lists newest first', async () => {
        const id = scene()
        await svc.writeDoc(project.id, id, 'x')
        const a = await svc.takeSnapshot(project.id, id, 'older')
        const b = await svc.takeSnapshot(project.id, id, 'newer')
        const list = await svc.listSnapshots(project.id, id)
        expect(list.map((s) => s.id).slice(0, 2)).toEqual([b.id, a.id])
      })

      it('deletes one without disturbing the others', async () => {
        const id = scene()
        await svc.writeDoc(project.id, id, 'x')
        const a = await svc.takeSnapshot(project.id, id, 'keep')
        const b = await svc.takeSnapshot(project.id, id, 'drop')
        await svc.deleteSnapshot(project.id, id, b.id)
        expect((await svc.listSnapshots(project.id, id)).map((s) => s.id)).toEqual([a.id])
      })

      it('returns an empty list for a document that has none', async () => {
        expect(await svc.listSnapshots(project.id, scene())).toEqual([])
      })

      it('survives a reopen with its body readable', async () => {
        // Invariant 5 leans on this: the pre-AI snapshot is worthless if it does
        // not outlive the session that took it.
        const id = scene()
        await svc.writeDoc(project.id, id, 'the text before')
        const snap = await svc.takeSnapshot(project.id, id, 'pre-AI')
        await svc.writeDoc(project.id, id, 'the text after')
        await svc.close(project.id)
        const fresh = harness.service()
        await harness.reopen(fresh, project)
        const listed = await fresh.listSnapshots(project.id, id)
        expect(listed.find((s) => s.id === snap.id)?.content).toBe('the text before')
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
        // aux names come from feature code, but a path traversal here would
        // write anywhere on the author's disk.
        await expect(svc.writeAux(project.id, '../escape.json', 'x')).rejects.toThrow()
        await expect(svc.readAux(project.id, '../../etc/passwd')).rejects.toThrow()
      })
    })

    describe('settings', () => {
      it('merges a patch instead of replacing the whole object', async () => {
        await svc.saveSettings(project.id, { author: 'Jane' })
        await svc.saveSettings(project.id, { wordTarget: 50_000 })
        await svc.close(project.id)
        const reopened = await harness.reopen(harness.service(), project)
        expect(reopened.settings.author).toBe('Jane')
        expect(reopened.settings.wordTarget).toBe(50_000)
      })
    })

    describe('probe', () => {
      it('reports a modification time per file, so an external edit is noticeable', async () => {
        await svc.writeDoc(project.id, scene(), 'first')
        const before = await svc.probe(project.id)
        expect(Object.keys(before)).toContain('project.json')
        expect(before[`docs/${scene()}.md`]).toBeGreaterThan(0)

        await svc.writeDoc(project.id, scene(), 'second')
        const after = await svc.probe(project.id)
        expect(after[`docs/${scene()}.md`]).toBeGreaterThanOrEqual(before[`docs/${scene()}.md`])
      })
    })

    describe('import', () => {
      it('builds a project out of loose Markdown', async () => {
        const imported = await harness.service().import({
          title: 'Imported', location: harness.location,
          docs: [
            { path: 'Chapter One/Scene A.md', content: 'Imported prose.' },
            { path: 'Chapter One/Scene B.md', content: 'More prose.' },
          ],
        })
        expect(imported.title).toBe('Imported')
        const titles = Object.values(imported.nodes).map((n) => n.title)
        expect(titles).toContain('Scene A')
        expect(titles).toContain('Chapter One')
        const sceneA = Object.values(imported.nodes).find((n) => n.title === 'Scene A')!
        expect(imported.docs[sceneA.id]?.content).toBe('Imported prose.')
      })
    })

    describe('compile', () => {
      const included = (p: Project) =>
        Object.values(p.nodes).filter((n) => n.type !== 'folder' && n.id !== p.trashId).map((n) => n.id)

      it('joins the manuscript into one Markdown file', async () => {
        await svc.writeDoc(project.id, scene(), 'Scene body.')
        const out = await svc.compile(project.id, project.rootIds[0]!, included(project), 'markdown')
        expect(new TextDecoder().decode(out.blob)).toContain('Scene body.')
        expect(out.filename).toMatch(/\.md$/)
      })

      it('produces a non-empty docx', async () => {
        await svc.writeDoc(project.id, scene(), 'Scene body.')
        const out = await svc.compile(project.id, project.rootIds[0]!, included(project), 'docx')
        expect(out.blob.byteLength).toBeGreaterThan(1000)
        expect(out.filename).toMatch(/\.docx$/)
      })

      it('leaves out what the author excluded', async () => {
        await svc.writeDoc(project.id, scene(), 'EXCLUDED_MARKER')
        const out = await svc.compile(project.id, project.rootIds[0]!, [], 'markdown')
        expect(new TextDecoder().decode(out.blob)).not.toContain('EXCLUDED_MARKER')
      })
    })
  })
}
