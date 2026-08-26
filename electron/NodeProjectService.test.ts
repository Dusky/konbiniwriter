// The project layer on a real filesystem.
//
// The shared contract every backend must satisfy lives in
// `src/lib/projectServiceContract.ts` and runs here against real bytes in a
// temp directory. The FSA and OPFS backends run the same suite against an
// in-memory File System Access implementation, so a divergence between the
// three now fails in whichever one diverged.
//
// Anything below the contract call is Node-specific: real paths, and the
// external-edit conflict machinery that only a filesystem can have.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { NodeProjectService } from './NodeProjectService'
import { runProjectServiceContract, type ProjectServiceLike } from '../src/lib/projectServiceContract'
import type { Project } from '../src/shared/types'

let tmp = ''
const bundleOf = (p: Project) => path.join(tmp, `${p.title.replace(/[<>:"/\\|?*]/g, '_')}.konbini`)

runProjectServiceContract('NodeProjectService', {
  location: '',
  async reset() {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'konbini-test-'))
    // `location` is the parent directory; the service appends `<title>.konbini`.
    this.location = tmp
  },
  service: () => new NodeProjectService() as unknown as ProjectServiceLike,
  create: (svc, title) => svc.create({ title, template: 'novel', location: tmp }),
  reopen: (svc, project) => (svc as unknown as NodeProjectService).open(bundleOf(project)),
  readRaw: (project, rel) => fs.readFile(path.join(bundleOf(project), rel), 'utf8').catch(() => null),
  existsRaw: async (project, rel) => !!(await fs.stat(path.join(bundleOf(project), rel)).catch(() => null)),
  afterEach: async () => { await fs.rm(tmp, { recursive: true, force: true }).catch(() => {}) },
})

// ── Node-only ───────────────────────────────────────────────────────────────

describe('NodeProjectService · real paths', () => {
  let dir: string
  let svc: NodeProjectService
  let project: Project

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'konbini-node-'))
    svc = new NodeProjectService()
    project = await svc.create({ title: 'Book', template: 'novel', location: dir })
  })
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}) })

  it('reports the bundle path, because the author has one', () => {
    // The browser backends return opaque keys here; only this one can point at
    // a folder the author could open in Finder.
    expect(svc.bundlePath(project.id)).toBe(path.join(dir, 'Book.konbini'))
  })

  it('sanitises a title that would be an illegal directory name', async () => {
    const p = await new NodeProjectService().create({ title: 'A/B: "C"', template: 'blank', location: dir })
    const name = path.basename(p.settings.location as string)
    expect(name).toBe('A_B_ _C_.konbini')
    expect(await fs.stat(path.join(dir, name))).toBeTruthy()
  })
})
