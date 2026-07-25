// electron/NodeProjectService.ts — Node.js fs/promises implementation of the project layer.
// Used by the Electron preload. All paths are real filesystem paths.

import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as path from 'path'

import { uid, wordCount, isValidAuxName } from '../src/shared/utils'
import { buildProjectFromTemplate } from '../src/shared/templates'
import { buildProjectFromDocs } from '../src/shared/importer'
import { applyNodeOp, migrateProject } from '../src/shared/nodeOps'
import { serializeManifest, serializeCodex, serializeDebt, adoptSidecars, CODEX_FILE, DEBT_FILE } from '../src/shared/bundle'
import type {
  Project, KNode, DocBody, NodeOp, Snapshot, ID, ImportDoc,
  CompileFormat, CompileResult, CodexEntry, DebtItem, ProjectSettings, TemplateId,
} from '../src/shared/types'

// ── FS helpers ────────────────────────────────────────────────────────────────

async function readText(dir: string, ...parts: string[]): Promise<string | null> {
  try {
    return await fs.readFile(path.join(dir, ...parts), 'utf-8')
  } catch { return null }
}

// Write via temp-file-then-rename so a crash mid-write can never leave a
// truncated .md or manifest behind (rename is atomic on the same filesystem).
async function writeText(dir: string, content: string, ...parts: string[]): Promise<void> {
  const p = path.join(dir, ...parts)
  await fs.mkdir(path.dirname(p), { recursive: true })
  const tmp = `${p}.tmp-${process.pid}`
  try {
    await fs.writeFile(tmp, content, 'utf-8')
    await fs.rename(tmp, p)
  } catch (e) {
    await fs.unlink(tmp).catch(() => {})
    throw e
  }
}

async function removeFile(dir: string, ...parts: string[]): Promise<void> {
  try { await fs.unlink(path.join(dir, ...parts)) } catch { /* ignore */ }
}

async function statMtime(full: string): Promise<number> {
  try { return (await fs.stat(full)).mtimeMs } catch { return 0 }
}

/** Notified when an external edit was preserved as a .conflict file. */
export interface ConflictEvent { projectId: string; nodeId: string; file: string }

// ── Service ───────────────────────────────────────────────────────────────────

export class NodeProjectService {
  private projects = new Map<string, Project>()
  private paths = new Map<string, string>()       // projectId → bundle dir
  private knownMtime = new Map<string, number>()  // `${projectId}:${nodeId}` → last mtime we read/wrote
  private conflictListeners = new Set<(e: ConflictEvent) => void>()

  /** Subscribe to external-edit conflicts (a .conflict backup was written). */
  onConflict(cb: (e: ConflictEvent) => void): () => void {
    this.conflictListeners.add(cb)
    return () => { this.conflictListeners.delete(cb) }
  }
  private emitConflict(e: ConflictEvent): void {
    for (const cb of this.conflictListeners) { try { cb(e) } catch { /* ignore */ } }
  }

  // ── Open ────────────────────────────────────────────────────────────────────

  async open(bundlePath: string): Promise<Project> {
    const manifestText = await readText(bundlePath, 'project.json')
    if (!manifestText) throw new Error('Not a Konbini project (no project.json)')

    const project: Project = JSON.parse(manifestText)
    // Upgrade an older bundle once, on open, so the file on disk stops
    // lagging what we hold in memory.
    const didMigrate = migrateProject(project)
    // Codex/debt live in sidecar files so sync can merge them apart from
    // the manifest; older bundles still carry them inline.
    const owesSidecars = adoptSidecars(
      project,
      await readText(bundlePath, CODEX_FILE),
      await readText(bundlePath, DEBT_FILE),
    )

    for (const nodeId of Object.keys(project.docs)) {
      const content = await readText(bundlePath, 'docs', `${nodeId}.md`)
      project.docs[nodeId] = { content: content ?? '', snapshots: project.docs[nodeId]?.snapshots ?? [] }
      this.knownMtime.set(`${project.id}:${nodeId}`, await statMtime(path.join(bundlePath, 'docs', `${nodeId}.md`)))
    }

    this.paths.set(project.id, bundlePath)
    this.projects.set(project.id, project)
    if (didMigrate || owesSidecars) {
      await writeText(bundlePath, serializeCodex(project.settings.codex ?? []), CODEX_FILE)
      await writeText(bundlePath, serializeDebt(project.settings.debt ?? []), DEBT_FILE)
      await this.writeManifest(bundlePath, project)
    }
    return project
  }

  // ── Create ──────────────────────────────────────────────────────────────────

  async create(opts: { title: string; template: TemplateId; location: string }): Promise<Project> {
    const bundleName = `${opts.title.replace(/[<>:"/\\|?*]/g, '_')}.konbini`
    const bundlePath = path.join(opts.location, bundleName)

    await fs.mkdir(path.join(bundlePath, 'docs'), { recursive: true })
    await fs.mkdir(path.join(bundlePath, 'snapshots'), { recursive: true })

    const project = buildProjectFromTemplate(opts.title, opts.template, bundlePath)

    for (const [nodeId, body] of Object.entries(project.docs)) {
      if (body.content) {
        await writeText(bundlePath, body.content, 'docs', `${nodeId}.md`)
      }
    }

    await this.writeManifest(bundlePath, project)
    this.paths.set(project.id, bundlePath)
    this.projects.set(project.id, project)
    return project
  }

  // ── Import ────────────────────────────────────────────────────────────────────

  async import(opts: { title: string; location: string; docs: ImportDoc[] }): Promise<Project> {
    const bundleName = `${opts.title.replace(/[<>:"/\\|?*]/g, '_')}.konbini`
    const bundlePath = path.join(opts.location, bundleName)
    await fs.mkdir(path.join(bundlePath, 'docs'), { recursive: true })
    await fs.mkdir(path.join(bundlePath, 'snapshots'), { recursive: true })

    const project = buildProjectFromDocs(opts.title, bundlePath, opts.docs)

    for (const [nodeId, body] of Object.entries(project.docs)) {
      await writeText(bundlePath, body.content, 'docs', `${nodeId}.md`)
      this.knownMtime.set(`${project.id}:${nodeId}`, await statMtime(path.join(bundlePath, 'docs', `${nodeId}.md`)))
    }

    await this.writeManifest(bundlePath, project)
    this.paths.set(project.id, bundlePath)
    this.projects.set(project.id, project)
    return project
  }

  // ── Close ───────────────────────────────────────────────────────────────────

  async close(id: string): Promise<void> {
    const project = this.projects.get(id)
    const p = this.paths.get(id)
    if (project && p) {
      project.modified = new Date().toISOString()
      await this.writeManifest(p, project)
    }
    this.projects.delete(id)
    this.paths.delete(id)
  }

  // ── Doc ─────────────────────────────────────────────────────────────────────

  async readDoc(projectId: string, nodeId: string): Promise<string> {
    const p = this.getPath(projectId)
    const content = (await readText(p, 'docs', `${nodeId}.md`)) ?? ''
    this.knownMtime.set(`${projectId}:${nodeId}`, await statMtime(path.join(p, 'docs', `${nodeId}.md`)))
    return content
  }

  async writeDoc(projectId: string, nodeId: string, content: string): Promise<void> {
    const p = this.getPath(projectId)
    const full = path.join(p, 'docs', `${nodeId}.md`)
    const key = `${projectId}:${nodeId}`

    // Conflict guard: if the file changed on disk since we last read/wrote it,
    // an external editor (git, Dropbox, vim…) touched it. Preserve that version
    // as a .conflict backup before overwriting, so nothing is silently lost.
    const known = this.knownMtime.get(key) ?? 0
    if (known) {
      const cur = await statMtime(full)
      if (cur > known + 1) {
        const onDisk = await readText(p, 'docs', `${nodeId}.md`)
        if (onDisk != null && onDisk !== content) {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-')
          const file = `${nodeId}.conflict-${stamp}.md`
          await writeText(p, onDisk, 'docs', file).catch(() => {})
          this.emitConflict({ projectId, nodeId, file })
        }
      }
    }

    await writeText(p, content, 'docs', `${nodeId}.md`)
    const proj = this.projects.get(projectId)
    if (proj?.docs[nodeId]) proj.docs[nodeId].content = content
    this.knownMtime.set(key, await statMtime(full))
  }

  // ── Node mutations ───────────────────────────────────────────────────────────

  /** The only platform-specific half of a node op: doc-file writes and deletes. */
  private nodeIO(dir: string) {
    return {
      writeDoc: (nodeId: ID, content: string) => writeText(dir, content, 'docs', `${nodeId}.md`),
      removeDoc: (nodeId: ID) => removeFile(dir, 'docs', `${nodeId}.md`),
    }
  }

  async mutateNode(projectId: string, op: NodeOp): Promise<{ rootIds: ID[]; nodes: Record<ID, KNode>; docs: Record<ID, DocBody> }> {
    const p = this.getPath(projectId)
    const proj = this.getProject(projectId)
    await applyNodeOp(proj, op, this.nodeIO(p))
    proj.modified = new Date().toISOString()
    await this.writeManifest(p, proj)
    return { rootIds: proj.rootIds, nodes: proj.nodes, docs: proj.docs }
  }


  // ── Snapshots ────────────────────────────────────────────────────────────────

  async takeSnapshot(projectId: string, nodeId: string, title = '', kind: 'manual' | 'auto' = 'manual'): Promise<Snapshot> {
    const dir = this.getPath(projectId)
    const proj = this.getProject(projectId)
    const content = proj.docs[nodeId]?.content ?? ''
    const snap: Snapshot = { id: uid('snap'), title, takenAt: new Date().toISOString(), content, words: wordCount(content), kind }
    await writeText(dir, content, 'snapshots', nodeId, `${snap.id}.md`)
    if (!proj.docs[nodeId]) proj.docs[nodeId] = { content, snapshots: [] }
    proj.docs[nodeId].snapshots = [{ ...snap, content: '' }, ...proj.docs[nodeId].snapshots]
    proj.modified = new Date().toISOString()
    await this.writeManifest(dir, proj)
    return snap
  }

  async restoreSnapshot(projectId: string, nodeId: string, snapshotId: string): Promise<{ content: string; snapshot: Snapshot }> {
    const dir = this.getPath(projectId)
    const content = await readText(dir, 'snapshots', nodeId, `${snapshotId}.md`)
    if (content === null) throw new Error('Snapshot file not found')
    await this.takeSnapshot(projectId, nodeId, 'before restore')
    await this.writeDoc(projectId, nodeId, content)
    const proj = this.getProject(projectId)
    const meta = proj.docs[nodeId]?.snapshots.find(s => s.id === snapshotId)
    return { content, snapshot: meta ? { ...meta, content } : { id: snapshotId, title: '', takenAt: new Date().toISOString(), content, words: wordCount(content) } }
  }

  async listSnapshots(projectId: string, nodeId: string): Promise<Snapshot[]> {
    const dir = this.getPath(projectId)
    const proj = this.getProject(projectId)
    const metas = proj.docs[nodeId]?.snapshots ?? []
    return Promise.all(metas.map(async m => {
      const content = await readText(dir, 'snapshots', nodeId, `${m.id}.md`) ?? ''
      return { ...m, content }
    }))
  }

  async deleteSnapshot(projectId: string, nodeId: string, snapshotId: string): Promise<void> {
    const dir = this.getPath(projectId)
    const proj = this.getProject(projectId)
    await removeFile(dir, 'snapshots', nodeId, `${snapshotId}.md`)
    if (proj.docs[nodeId]) proj.docs[nodeId].snapshots = proj.docs[nodeId].snapshots.filter(s => s.id !== snapshotId)
    await this.writeManifest(dir, proj)
  }

  // ── Compile ──────────────────────────────────────────────────────────────────

  async compile(projectId: string, rootId: string, includedIds: string[], format: CompileFormat): Promise<CompileResult> {
    const dir = this.getPath(projectId)
    const proj = this.getProject(projectId)
    const chapters: Array<{ title: string; content: string }> = []
    const gather = async (id: string) => {
      const node = proj.nodes[id]
      if (!node) return
      if (node.type !== 'folder' && includedIds.includes(id)) {
        const content = proj.docs[id]?.content ?? await readText(dir, 'docs', `${id}.md`) ?? ''
        if (content.trim()) chapters.push({ title: node.title, content: content.trim() })
      }
      for (const cid of node.childIds) await gather(cid)
    }
    await gather(rootId)
    const projectTitle = proj.title.replace(/[<>:"/\\|?*]/g, '_')

    if (format === 'markdown') {
      const combined = chapters.map(c => c.content).join('\n\n---\n\n')
      return { blob: new TextEncoder().encode(combined), filename: `${projectTitle}.md`, format: 'markdown' }
    }
    if (format === 'epub') {
      const { buildEpub } = await import('../src/shared/epubBuilder')
      const blob = await buildEpub({
        title: proj.title,
        author: proj.settings.author,
        language: proj.settings.language,
        chapters: chapters.map((c, i) => ({
          id: `ch_${String(i + 1).padStart(4, '0')}`,
          title: c.title,
          markdown: c.content,
        })),
      })
      return { blob, filename: `${projectTitle}.epub`, format: 'epub' }
    }
    const { buildDocx } = await import('../src/shared/docxBuilder')
    const blob = await buildDocx({
      title: proj.title,
      author: proj.settings.author,
      style: format === 'shunn' ? 'shunn' : 'manuscript',
      chapters: chapters.map(c => ({ title: c.title, markdown: c.content })),
    })
    const suffix = format === 'shunn' ? '.manuscript.docx' : '.docx'
    return { blob, filename: `${projectTitle}${suffix}`, format }
  }

  // ── Settings / Codex ─────────────────────────────────────────────────────────

  async saveSettings(projectId: string, patch: Partial<ProjectSettings>): Promise<void> {
    const dir = this.getPath(projectId)
    const proj = this.getProject(projectId)
    Object.assign(proj.settings, patch)
    proj.modified = new Date().toISOString()
    await this.writeManifest(dir, proj)
  }

  async saveCodex(projectId: string, entries: CodexEntry[]): Promise<void> {
    const dir = this.getPath(projectId)
    const proj = this.getProject(projectId)
    proj.settings.codex = entries
    proj.modified = new Date().toISOString()
    // Sidecar write only — the codex is no longer part of the manifest.
    await writeText(dir, serializeCodex(entries), CODEX_FILE)
  }

  async saveDebt(projectId: string, items: DebtItem[]): Promise<void> {
    const dir = this.getPath(projectId)
    const proj = this.getProject(projectId)
    proj.settings.debt = items
    proj.modified = new Date().toISOString()
    await writeText(dir, serializeDebt(items), DEBT_FILE)
  }

  // ── Aux files ─────────────────────────────────────────────────────────────

  async readAux(projectId: string, name: string): Promise<string | null> {
    if (!isValidAuxName(name)) throw new Error(`Invalid aux file name: ${name}`)
    const dir = this.getPath(projectId)
    return readText(dir, 'aux', name)
  }

  async writeAux(projectId: string, name: string, content: string): Promise<void> {
    if (!isValidAuxName(name)) throw new Error(`Invalid aux file name: ${name}`)
    const dir = this.getPath(projectId)
    await writeText(dir, content, 'aux', name)
  }

  async removeAux(projectId: string, name: string): Promise<void> {
    if (!isValidAuxName(name)) throw new Error(`Invalid aux file name: ${name}`)
    const dir = this.getPath(projectId)
    await removeFile(dir, 'aux', name)
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private getPath(projectId: string): string {
    const p = this.paths.get(projectId)
    if (!p) throw new Error(`Project not open: ${projectId}`)
    return p
  }

  /** Public bundle path for the open project (used to run a local agent in it). */
  bundlePath(projectId: string): string | null {
    return this.paths.get(projectId) ?? null
  }

  private getProject(projectId: string): Project {
    const p = this.projects.get(projectId)
    if (!p) throw new Error(`Project not in cache: ${projectId}`)
    return p
  }

  private async writeManifest(dir: string, project: Project): Promise<void> {
    await writeText(dir, serializeManifest(project), 'project.json')
  }

  private descendants(proj: Project, id: string): string[] {
    const acc: string[] = []
    const walk = (i: string) => { for (const c of proj.nodes[i]?.childIds ?? []) { acc.push(c); walk(c) } }
    walk(id)
    return acc
  }
}

export const nodeProjectService = new NodeProjectService()
