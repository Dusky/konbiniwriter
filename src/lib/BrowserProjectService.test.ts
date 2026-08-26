// The File System Access backend — Chrome/Edge, real files on the author's disk.
//
// This backend had no automated coverage at all: `scripts/smoke.mjs` deletes
// `showDirectoryPicker` before the app boots so it can drive OPFS without a
// native dialog, which means the path most Konbini users actually run was
// exercised by nothing. Here it runs the shared contract against an in-memory
// File System Access implementation (`src/test/memfs.ts`), with the directory
// picker stubbed — the same code, the same handles, no dialog.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { BrowserProjectService, isFileSystemAccessSupported } from './BrowserProjectService'
import { runProjectServiceContract, type ProjectServiceLike } from './projectServiceContract'
import { memRoot, type MemDirectoryHandle } from '../test/memfs'
import type { Project } from '@shared/types'

let root: MemDirectoryHandle
/** What the next `showDirectoryPicker()` hands back. */
let picked: () => MemDirectoryHandle

function installPicker(): void {
  const w = globalThis as unknown as { window?: Record<string, unknown> }
  if (!w.window) w.window = globalThis as unknown as Record<string, unknown>
  ;(w.window as Record<string, unknown>).showDirectoryPicker = async () => picked()
}

const bundleName = (p: Project) => `${p.title.replace(/[<>:"/\\|?*]/g, '_')}.konbini`

runProjectServiceContract('BrowserProjectService (File System Access)', {
  location: 'browser-pick',
  async reset() {
    root = memRoot('Documents')
    picked = () => root
    installPicker()
  },
  service: () => new BrowserProjectService() as unknown as ProjectServiceLike,
  create: (svc, title) => svc.create({ title, template: 'novel', location: 'browser-pick' }),
  async reopen(svc, project) {
    // Reopening means walking back in through the picker and handing the
    // service a bundle handle it has never seen — the real cold-open path.
    const bundle = await root.getDirectoryHandle(bundleName(project))
    const previous = picked
    picked = () => bundle
    try {
      const s = svc as unknown as BrowserProjectService
      const key = (await s.showOpenDialog())!
      return await s.open(key)
    } finally { picked = previous }
  },
  readRaw: (project, rel) => root.readPath(`${bundleName(project)}/${rel}`),
  existsRaw: (project, rel) => root.has(`${bundleName(project)}/${rel}`),
})

// ── FSA-only ────────────────────────────────────────────────────────────────

describe('BrowserProjectService · handles and permissions', () => {
  beforeEach(() => {
    root = memRoot('Documents')
    picked = () => root
    installPicker()
  })

  it('reports the API as supported only when the picker exists', () => {
    expect(isFileSystemAccessSupported()).toBe(true)
    const w = globalThis as unknown as { window: Record<string, unknown> }
    const saved = w.window.showDirectoryPicker
    delete w.window.showDirectoryPicker
    expect(isFileSystemAccessSupported()).toBe(false)
    w.window.showDirectoryPicker = saved
  })

  it('refuses to create without the API rather than failing halfway', async () => {
    const w = globalThis as unknown as { window: Record<string, unknown> }
    const saved = w.window.showDirectoryPicker
    delete w.window.showDirectoryPicker
    await expect(new BrowserProjectService().create({ title: 'X', template: 'blank', location: 'browser-pick' }))
      .rejects.toThrow(/File System Access/)
    w.window.showDirectoryPicker = saved
  })

  it('treats a cancelled picker as "no folder selected", not a crash', async () => {
    picked = () => { throw new DOMException('The user aborted a request.', 'AbortError') }
    await expect(new BrowserProjectService().create({ title: 'X', template: 'blank', location: 'browser-pick' }))
      .rejects.toThrow(/No folder selected/)
  })

  it('a cancelled open dialog returns null instead of throwing', async () => {
    picked = () => { throw new DOMException('The user aborted a request.', 'AbortError') }
    expect(await new BrowserProjectService().showOpenDialog()).toBeNull()
  })

  it('names the bundle after the project, sanitising what a folder cannot hold', async () => {
    const svc = new BrowserProjectService()
    await svc.create({ title: 'A/B: "C"', template: 'blank', location: 'browser-pick' })
    expect(await root.has('A_B_ _C_.konbini/project.json')).toBe(true)
  })

  it('lays the bundle out the way the format promises', async () => {
    const svc = new BrowserProjectService()
    const p = await svc.create({ title: 'Book', template: 'novel', location: 'browser-pick' })
    const id = Object.values(p.nodes).find((n) => n.type !== 'folder' && n.id !== p.trashId)!.id
    await svc.writeDoc(p.id, id, 'prose')
    await svc.takeSnapshot(p.id, id, 'v1')
    const paths = await root.paths()
    expect(paths).toContain('Book.konbini/project.json')
    expect(paths).toContain(`Book.konbini/docs/${id}.md`)
    expect(paths.some((f) => f.startsWith(`Book.konbini/snapshots/${id}/`))).toBe(true)
  })

  it('gives up on a stored handle whose permission is refused', async () => {
    // A handle survives in IndexedDB across sessions but its permission does
    // not, so a refused prompt has to fall back to the picker rather than
    // opening something the author did not authorise.
    const svc = new BrowserProjectService()
    const p = await svc.create({ title: 'Book', template: 'blank', location: 'browser-pick' })
    const bundle = await root.getDirectoryHandle('Book.konbini')
    vi.spyOn(bundle, 'queryPermission').mockResolvedValue('prompt')
    vi.spyOn(bundle, 'requestPermission').mockResolvedValue('denied')

    const handleStore = (await import('./HandleStore')).handleStore
    vi.spyOn(handleStore, 'get').mockResolvedValue(bundle as unknown as FileSystemDirectoryHandle)
    expect(await new BrowserProjectService().openByHandle(p.id)).toBeNull()
    vi.restoreAllMocks()
  })

  it('opens straight from a stored handle when permission is already granted', async () => {
    const svc = new BrowserProjectService()
    const p = await svc.create({ title: 'Book', template: 'blank', location: 'browser-pick' })
    const bundle = await root.getDirectoryHandle('Book.konbini')
    const handleStore = (await import('./HandleStore')).handleStore
    vi.spyOn(handleStore, 'get').mockResolvedValue(bundle as unknown as FileSystemDirectoryHandle)
    const reopened = await new BrowserProjectService().openByHandle(p.id)
    expect(reopened?.title).toBe('Book')
    vi.restoreAllMocks()
  })

  it('forgets a stored handle whose bundle has gone', async () => {
    const svc = new BrowserProjectService()
    const p = await svc.create({ title: 'Book', template: 'blank', location: 'browser-pick' })
    const empty = memRoot('Gone')
    const handleStore = (await import('./HandleStore')).handleStore
    vi.spyOn(handleStore, 'get').mockResolvedValue(empty as unknown as FileSystemDirectoryHandle)
    const del = vi.spyOn(handleStore, 'del').mockResolvedValue()
    expect(await new BrowserProjectService().openByHandle(p.id)).toBeNull()
    expect(del).toHaveBeenCalledWith(p.id)
    vi.restoreAllMocks()
  })

  it('refuses a folder that is not a Konbini bundle', async () => {
    const svc = new BrowserProjectService()
    const key = (await svc.showOpenDialog())!
    await expect(svc.open(key)).rejects.toThrow(/project\.json/)
  })
})
