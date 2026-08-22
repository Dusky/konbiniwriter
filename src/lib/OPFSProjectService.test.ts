// The Origin Private File System backend — Firefox and Safari, where there is
// no folder to point at and the bundle lives inside browser storage.
//
// `scripts/smoke.mjs` drives this backend in a real browser, which is the
// stronger test of the two but only covers what the UI happens to exercise.
// Running the shared contract here against the same in-memory File System
// Access implementation the FSA backend uses means a disagreement between the
// two browser backends fails by name instead of showing up as a mystery on one
// platform.

import { describe, it, expect, beforeEach } from 'vitest'
import { OPFSProjectService, isOPFSSupported } from './OPFSProjectService'
import { runProjectServiceContract, type ProjectServiceLike } from './projectServiceContract'
import { memRoot, type MemDirectoryHandle } from '../test/memfs'
import type { Project } from '@shared/types'

let storage: MemDirectoryHandle

function installOPFS(): void {
  const g = globalThis as unknown as { navigator?: Record<string, unknown> }
  if (!g.navigator) g.navigator = {} as Record<string, unknown>
  Object.defineProperty(g.navigator, 'storage', {
    value: { getDirectory: async () => storage },
    configurable: true,
    writable: true,
  })
}

/** OPFS names the bundle after the project id, not its title. */
const projectsDir = () => storage.getDirectoryHandle('konbini-projects', { create: true })

runProjectServiceContract('OPFSProjectService', {
  location: 'opfs',
  async reset() {
    storage = memRoot('opfs')
    installOPFS()
  },
  service: () => new OPFSProjectService() as unknown as ProjectServiceLike,
  create: (svc, title) => svc.create({ title, template: 'novel', location: 'opfs' }),
  reopen: (svc, project) => (svc as unknown as OPFSProjectService).open(`opfs:${project.id}`),
  readRaw: async (project, rel) => (await projectsDir()).readPath(`${project.id}.konbini/${rel}`),
  existsRaw: async (project, rel) => (await projectsDir()).has(`${project.id}.konbini/${rel}`),
})

// ── OPFS-only ───────────────────────────────────────────────────────────────

describe('OPFSProjectService · browser-internal storage', () => {
  beforeEach(() => { storage = memRoot('opfs'); installOPFS() })

  it('reports itself supported when navigator.storage can hand out a directory', () => {
    expect(isOPFSSupported()).toBe(true)
  })

  it('offers no directory picker, because there is no directory to pick', async () => {
    // Firefox and Safari have no File System Access dialog; OPFS users navigate
    // by the Recents list instead, so these deliberately answer null rather
    // than throwing at the call site.
    const svc = new OPFSProjectService()
    expect(await svc.showOpenDialog()).toBeNull()
    expect(await svc.showSaveDialog('Book')).toBeNull()
  })

  it('addresses a project by an opfs: location, and keeps it in the manifest', async () => {
    const p: Project = await new OPFSProjectService().create({ title: 'Book', template: 'blank', location: 'ignored' })
    expect(p.settings.location).toBe(`opfs:${p.id}`)
    const dir = await projectsDir()
    expect(await dir.has(`${p.id}.konbini/project.json`)).toBe(true)
  })

  it('opens by bare id as well as by opfs: prefix', async () => {
    const created = await new OPFSProjectService().create({ title: 'Book', template: 'blank', location: '' })
    expect((await new OPFSProjectService().open(created.id)).title).toBe('Book')
    expect((await new OPFSProjectService().open(`opfs:${created.id}`)).title).toBe('Book')
  })

  it('two projects with the same title do not collide', async () => {
    // FSA names the bundle after the title, so a duplicate title reopens the
    // same folder. OPFS names it after the id, and must not have that problem.
    const svc = new OPFSProjectService()
    const a = await svc.create({ title: 'Book', template: 'blank', location: '' })
    const b = await svc.create({ title: 'Book', template: 'blank', location: '' })
    expect(a.id).not.toBe(b.id)
    const dir = await projectsDir()
    expect(await dir.has(`${a.id}.konbini/project.json`)).toBe(true)
    expect(await dir.has(`${b.id}.konbini/project.json`)).toBe(true)
  })

  it('refuses a bundle with no manifest', async () => {
    const dir = await projectsDir()
    await dir.getDirectoryHandle('bogus.konbini', { create: true })
    await expect(new OPFSProjectService().open('bogus')).rejects.toThrow(/project\.json/)
  })
})
