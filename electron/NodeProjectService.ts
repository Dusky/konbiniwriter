// electron/NodeProjectService.ts — Node.js fs/promises implementation of the project layer.
// Used by the Electron preload. All paths are real filesystem paths.

import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as path from 'path'

import { uid, wordCount } from '../src/shared/utils'
import { buildProjectFromTemplate } from '../src/shared/templates'
import type {
  Project, KNode, DocBody, NodeOp, Snapshot, ID,
  CompileFormat, CompileResult, CodexEntry, ProjectSettings, TemplateId,
} from '../src/shared/types'

// ── FS helpers ────────────────────────────────────────────────────────────────

async function readText(dir: string, ...parts: string[]): Promise<string | null> {
  try {
    return await fs.readFile(path.join(dir, ...parts), 'utf-8')
  } catch { return null }
}

async function writeText(dir: string, content: string, ...parts: string[]): Promise<void> {
  const p = path.join(dir, ...parts)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, content, 'utf-8')
}

async function removeFile(dir: string, ...parts: string[]): Promise<void> {
  try { await fs.unlink(path.join(dir, ...parts)) } catch { /* ignore */ }
}

// ── Service ───────────────────────────────────────────────────────────────────

export class NodeProjectService {
  private projects = new Map<string, Project>()
  private paths = new Map<string, string>()       // projectId → bundle dir

  // ── Open ────────────────────────────────────────────────────────────────────

  async open(bundlePath: string): Promise<Project> {
    const manifestText = await readText(bundlePath, 'project.json')
    if (!manifestText) throw new Error('Not a Konbini project (no project.json)')

    const project: Project = JSON.parse(manifestText)

    for (const nodeId of Object.keys(project.docs)) {
      const content = await readText(bundlePath, 'docs', `${nodeId}.md`)
      project.docs[nodeId] = { content: content ?? '', snapshots: project.docs[nodeId]?.snapshots ?? [] }
    }

    this.paths.set(project.id, bundlePath)
    this.projects.set(project.id, project)
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
    return (await readText(this.getPath(projectId), 'docs', `${nodeId}.md`)) ?? ''
  }

  async writeDoc(projectId: string, nodeId: string, content: string): Promise<void> {
    const p = this.getPath(projectId)
    await writeText(p, content, 'docs', `${nodeId}.md`)
    const proj = this.projects.get(projectId)
    if (proj?.docs[nodeId]) proj.docs[nodeId].content = content
  }

  // ── Node mutations ───────────────────────────────────────────────────────────

  async mutateNode(projectId: string, op: NodeOp): Promise<{ rootIds: ID[]; nodes: Record<ID, KNode>; docs: Record<ID, DocBody> }> {
    const p = this.getPath(projectId)
    const proj = this.getProject(projectId)
    await this.applyOp(proj, op, p)
    proj.modified = new Date().toISOString()
    await this.writeManifest(p, proj)
    return { rootIds: proj.rootIds, nodes: proj.nodes, docs: proj.docs }
  }

  private async applyOp(proj: Project, op: NodeOp, dir: string): Promise<void> {
    switch (op.type) {
      case 'create': {
        const id = uid(op.nodeType)
        proj.nodes[id] = {
          id, type: op.nodeType,
          title: op.title ?? (op.nodeType === 'folder' ? 'New Folder' : op.nodeType === 'scene' ? 'New Scene' : 'New Document'),
          parentId: op.parentId, childIds: [], expanded: op.nodeType === 'folder',
          meta: { label: op.nodeType === 'scene' ? 'scene' : 'none', status: 'todo', synopsis: '', target: 0, includeInCompile: op.nodeType !== 'folder' },
          ext: { _newId: id },
        }
        if (op.nodeType !== 'folder') {
          proj.docs[id] = { content: '', snapshots: [] }
          await writeText(dir, '', 'docs', `${id}.md`)
        }
        if (op.parentId == null) {
          proj.rootIds.splice(op.atIndex ?? proj.rootIds.length, 0, id)
        } else {
          const parent = proj.nodes[op.parentId]
          parent.childIds.splice(op.atIndex ?? parent.childIds.length, 0, id)
          parent.expanded = true
        }
        break
      }
      case 'rename':
        if (proj.nodes[op.id]) proj.nodes[op.id].title = op.title
        break
      case 'setProjectTitle':
        proj.title = op.title
        break
      case 'move': {
        const node = proj.nodes[op.id]
        if (!node || op.id === op.newParentId) break
        if (op.newParentId != null && this.descendants(proj, op.id).includes(op.newParentId)) break
        if (node.parentId == null) proj.rootIds = proj.rootIds.filter(x => x !== op.id)
        else { const old = proj.nodes[node.parentId]; if (old) old.childIds = old.childIds.filter(x => x !== op.id) }
        node.parentId = op.newParentId
        if (op.newParentId == null) proj.rootIds.splice(op.atIndex, 0, op.id)
        else { const np = proj.nodes[op.newParentId]; if (np) { np.childIds.splice(op.atIndex, 0, op.id); np.expanded = true } }
        break
      }
      case 'duplicate': {
        const cloneRec = async (srcId: string, parentId: string | null): Promise<string> => {
          const src = proj.nodes[srcId]
          const nid = uid(src.type)
          proj.nodes[nid] = { ...src, id: nid, parentId, childIds: [], title: src.title + ' copy', meta: { ...src.meta }, ext: { ...src.ext } }
          if (proj.docs[srcId]) {
            const content = proj.docs[srcId].content
            proj.docs[nid] = { content, snapshots: [] }
            await writeText(dir, content, 'docs', `${nid}.md`)
          }
          proj.nodes[nid].childIds = await Promise.all(src.childIds.map(c => cloneRec(c, nid)))
          return nid
        }
        const src = proj.nodes[op.id]
        const newId = await cloneRec(op.id, src.parentId)
        if (src.parentId == null) { const i = proj.rootIds.indexOf(op.id); proj.rootIds.splice(i + 1, 0, newId) }
        else { const par = proj.nodes[src.parentId]; const i = par.childIds.indexOf(op.id); par.childIds.splice(i + 1, 0, newId) }
        break
      }
      case 'trash': {
        const node = proj.nodes[op.id]
        if (!node || !proj.trashId || node.parentId === proj.trashId) break
        if (node.parentId == null) proj.rootIds = proj.rootIds.filter(x => x !== op.id)
        else { const old = proj.nodes[node.parentId]; if (old) old.childIds = old.childIds.filter(x => x !== op.id) }
        node.parentId = proj.trashId
        proj.nodes[proj.trashId].childIds.push(op.id)
        proj.nodes[proj.trashId].expanded = true
        break
      }
      case 'delete': {
        const kill = [op.id, ...this.descendants(proj, op.id)]
        const node = proj.nodes[op.id]
        if (!node) break
        if (node.parentId == null) proj.rootIds = proj.rootIds.filter(x => x !== op.id)
        else { const old = proj.nodes[node.parentId]; if (old) old.childIds = old.childIds.filter(x => x !== op.id) }
        for (const k of kill) {
          await removeFile(dir, 'docs', `${k}.md`)
          delete proj.nodes[k]; delete proj.docs[k]
        }
        break
      }
      case 'updateMeta':
        if (proj.nodes[op.id]) proj.nodes[op.id].meta = { ...proj.nodes[op.id].meta, ...op.patch }
        break
      case 'setExpanded':
        if (proj.nodes[op.id]) proj.nodes[op.id].expanded = op.expanded
        break
    }
  }

  // ── Snapshots ────────────────────────────────────────────────────────────────

  async takeSnapshot(projectId: string, nodeId: string, title = ''): Promise<Snapshot> {
    const dir = this.getPath(projectId)
    const proj = this.getProject(projectId)
    const content = proj.docs[nodeId]?.content ?? ''
    const snap: Snapshot = { id: uid('snap'), title, takenAt: new Date().toISOString(), content, words: wordCount(content) }
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
    const chunks: string[] = []
    const gather = async (id: string) => {
      const node = proj.nodes[id]
      if (!node) return
      if (node.type !== 'folder' && includedIds.includes(id)) {
        const content = proj.docs[id]?.content ?? await readText(dir, 'docs', `${id}.md`) ?? ''
        if (content.trim()) chunks.push(content.trim())
      }
      for (const cid of node.childIds) await gather(cid)
    }
    await gather(rootId)
    const combined = chunks.join('\n\n---\n\n')
    const projectTitle = proj.title.replace(/[<>:"/\\|?*]/g, '_')

    if (format === 'markdown') {
      return { blob: new TextEncoder().encode(combined), filename: `${projectTitle}.md`, format: 'markdown' }
    }
    const { Document, Paragraph, TextRun, Packer } = await import('docx')
    const paras = combined.split('\n').map(line => {
      const h = line.match(/^(#{1,3})\s+(.+)$/)
      if (h) return new Paragraph({ text: h[2], heading: h[1].length === 1 ? 'Heading1' : h[1].length === 2 ? 'Heading2' : 'Heading3' })
      return new Paragraph({ children: [new TextRun(line)] })
    })
    const doc = new Document({ sections: [{ children: paras }] })
    const blob = await Packer.toBuffer(doc)
    return { blob: new Uint8Array(blob as unknown as ArrayBuffer), filename: `${projectTitle}.docx`, format: 'docx' }
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
    await this.writeManifest(dir, proj)
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private getPath(projectId: string): string {
    const p = this.paths.get(projectId)
    if (!p) throw new Error(`Project not open: ${projectId}`)
    return p
  }

  private getProject(projectId: string): Project {
    const p = this.projects.get(projectId)
    if (!p) throw new Error(`Project not in cache: ${projectId}`)
    return p
  }

  private async writeManifest(dir: string, project: Project): Promise<void> {
    const slim = {
      ...project,
      docs: Object.fromEntries(
        Object.entries(project.docs).map(([k, v]) => [k, { snapshots: v.snapshots.map(s => ({ ...s, content: '' })) }])
      ),
    }
    await writeText(dir, JSON.stringify(slim, null, 2), 'project.json')
  }

  private descendants(proj: Project, id: string): string[] {
    const acc: string[] = []
    const walk = (i: string) => { for (const c of proj.nodes[i]?.childIds ?? []) { acc.push(c); walk(c) } }
    walk(id)
    return acc
  }
}

export const nodeProjectService = new NodeProjectService()
