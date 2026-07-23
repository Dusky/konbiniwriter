// OPFSProjectService — Origin Private File System implementation of the project layer.
//
// Firefox 111+ supports OPFS via navigator.storage.getDirectory().
// The FileSystemDirectoryHandle API is identical to File System Access API,
// so all FS helpers and internal logic are the same as BrowserProjectService.
//
// Key differences from BrowserProjectService:
//   - No showDirectoryPicker calls; root is navigator.storage.getDirectory()
//   - Projects live in an 'konbini-projects/' subdir of the OPFS root
//   - showOpenDialog() / showSaveDialog() return null (users reopen via Recents)
//   - create() stores location as 'opfs:' + project.id
//   - open(location) parses the 'opfs:' prefix to find the bundle dir

import type { Project, KNode, DocBody, NodeOp, Snapshot, ID, ImportDoc, CompileFormat, CompileResult } from '@shared/types'
import { uid, wordCount, isValidAuxName } from '@shared/utils'
import { buildProjectFromTemplate } from '@shared/templates'
import { buildProjectFromDocs } from '@shared/importer'

export function isOPFSSupported(): boolean {
  return typeof navigator !== 'undefined' && 'storage' in navigator && typeof (navigator.storage as any).getDirectory === 'function'
}

// ── FS helpers ───────────────────────────────────────────────────────────────

async function readText(dir: FileSystemDirectoryHandle, ...parts: string[]): Promise<string | null> {
  try {
    let cur: FileSystemDirectoryHandle = dir
    for (let i = 0; i < parts.length - 1; i++) {
      cur = await cur.getDirectoryHandle(parts[i])
    }
    const fh = await cur.getFileHandle(parts[parts.length - 1])
    return (await fh.getFile()).text()
  } catch {
    return null
  }
}

async function writeText(dir: FileSystemDirectoryHandle, content: string, ...parts: string[]): Promise<void> {
  let cur: FileSystemDirectoryHandle = dir
  for (let i = 0; i < parts.length - 1; i++) {
    cur = await cur.getDirectoryHandle(parts[i], { create: true })
  }
  const fh = await cur.getFileHandle(parts[parts.length - 1], { create: true })
  const w = await fh.createWritable()
  await w.write(content)
  await w.close()
}

async function removeFile(dir: FileSystemDirectoryHandle, ...parts: string[]): Promise<void> {
  try {
    let cur: FileSystemDirectoryHandle = dir
    for (let i = 0; i < parts.length - 1; i++) {
      cur = await cur.getDirectoryHandle(parts[i])
    }
    await cur.removeEntry(parts[parts.length - 1])
  } catch { /* ignore */ }
}

// ── Service ──────────────────────────────────────────────────────────────────

export class OPFSProjectService {
  // Bundle handles for open projects (key = project.id)
  private handles = new Map<string, FileSystemDirectoryHandle>()
  // In-memory project state cache
  private projects = new Map<string, Project>()

  // Returns the konbini-projects/ subdir in OPFS, creating it if needed
  private async getRoot(): Promise<FileSystemDirectoryHandle> {
    const opfsRoot = await navigator.storage.getDirectory()
    return opfsRoot.getDirectoryHandle('konbini-projects', { create: true })
  }

  // ── Dialog helpers ────────────────────────────────────────────────────────
  // OPFS users navigate projects via the Recents list, not directory pickers.

  async showOpenDialog(): Promise<string | null> {
    return null
  }

  async showSaveDialog(_name: string): Promise<string | null> {
    return null
  }

  // ── Open ─────────────────────────────────────────────────────────────────

  async open(location: string): Promise<Project> {
    // location is 'opfs:' + projectId
    const projectId = location.startsWith('opfs:') ? location.slice('opfs:'.length) : location
    const root = await this.getRoot()
    const bundleHandle = await root.getDirectoryHandle(`${projectId}.konbini`)

    const manifestText = await readText(bundleHandle, 'project.json')
    if (!manifestText) throw new Error('Not a Konbini project (no project.json)')

    const project: Project = JSON.parse(manifestText)

    // Eagerly load all doc content
    for (const nodeId of Object.keys(project.docs)) {
      const content = await readText(bundleHandle, 'docs', `${nodeId}.md`)
      project.docs[nodeId] = { content: content ?? '', snapshots: project.docs[nodeId]?.snapshots ?? [] }
    }

    this.handles.set(project.id, bundleHandle)
    this.projects.set(project.id, project)
    return project
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async create(opts: { title: string; template: 'blank' | 'novel' | 'screenplay' | 'nonfiction'; location: string }): Promise<Project> {
    const root = await this.getRoot()

    // Build the project first so we have an id, then use that as the bundle name
    const project = buildProjectFromTemplate(opts.title, opts.template, '')
    const bundleName = `${project.id}.konbini`
    const bundleHandle = await root.getDirectoryHandle(bundleName, { create: true })

    // Ensure subdirs
    await bundleHandle.getDirectoryHandle('docs', { create: true })
    await bundleHandle.getDirectoryHandle('snapshots', { create: true })

    // Set OPFS location
    project.settings.location = 'opfs:' + project.id

    // Write all doc .md files
    for (const [nodeId, body] of Object.entries(project.docs)) {
      if (body.content) {
        await writeText(bundleHandle, body.content, 'docs', `${nodeId}.md`)
      }
    }

    await this.writeManifest(bundleHandle, project)
    this.handles.set(project.id, bundleHandle)
    this.projects.set(project.id, project)
    return project
  }

  async import(opts: { title: string; location: string; docs: ImportDoc[] }): Promise<Project> {
    const root = await this.getRoot()
    const project = buildProjectFromDocs(opts.title, '', opts.docs)
    const bundleName = `${project.id}.konbini`
    const bundleHandle = await root.getDirectoryHandle(bundleName, { create: true })
    await bundleHandle.getDirectoryHandle('docs', { create: true })
    await bundleHandle.getDirectoryHandle('snapshots', { create: true })
    project.settings.location = 'opfs:' + project.id
    for (const [nodeId, body] of Object.entries(project.docs)) {
      await writeText(bundleHandle, body.content, 'docs', `${nodeId}.md`)
    }
    await this.writeManifest(bundleHandle, project)
    this.handles.set(project.id, bundleHandle)
    this.projects.set(project.id, project)
    return project
  }

  // ── Close ─────────────────────────────────────────────────────────────────

  async close(id: string): Promise<void> {
    const project = this.projects.get(id)
    const handle = this.handles.get(id)
    if (project && handle) {
      project.modified = new Date().toISOString()
      await this.writeManifest(handle, project)
    }
    this.handles.delete(id)
    this.projects.delete(id)
  }

  // ── Doc read / write ──────────────────────────────────────────────────────

  async readDoc(projectId: string, nodeId: string): Promise<string> {
    const h = this.getHandle(projectId)
    return (await readText(h, 'docs', `${nodeId}.md`)) ?? ''
  }

  async writeDoc(projectId: string, nodeId: string, content: string): Promise<void> {
    const h = this.getHandle(projectId)
    await writeText(h, content, 'docs', `${nodeId}.md`)
    const p = this.projects.get(projectId)
    if (p?.docs[nodeId]) p.docs[nodeId].content = content
  }

  // ── Node mutations ────────────────────────────────────────────────────────

  async mutateNode(projectId: string, op: NodeOp): Promise<{ rootIds: ID[]; nodes: Record<ID, KNode>; docs: Record<ID, DocBody> }> {
    const h = this.getHandle(projectId)
    const p = this.getProject(projectId)
    await this.applyOp(p, op, h)
    p.modified = new Date().toISOString()
    await this.writeManifest(h, p)
    return { rootIds: p.rootIds, nodes: p.nodes, docs: p.docs }
  }

  private async applyOp(p: Project, op: NodeOp, h: FileSystemDirectoryHandle): Promise<void> {
    switch (op.type) {
      case 'create': {
        const id = uid(op.nodeType)
        p.nodes[id] = {
          id, type: op.nodeType,
          title: op.title ?? (op.nodeType === 'folder' ? 'New Folder' : op.nodeType === 'scene' ? 'New Scene' : 'New Document'),
          parentId: op.parentId, childIds: [], expanded: op.nodeType === 'folder',
          meta: { label: op.nodeType === 'scene' ? 'scene' : 'none', status: 'todo', synopsis: '', target: 0, includeInCompile: op.nodeType !== 'folder' },
          ext: { _newId: id },
        }
        if (op.nodeType !== 'folder') {
          p.docs[id] = { content: '', snapshots: [] }
          await writeText(h, '', 'docs', `${id}.md`)
        }
        if (op.parentId == null) {
          p.rootIds.splice(op.atIndex ?? p.rootIds.length, 0, id)
        } else {
          const parent = p.nodes[op.parentId]
          parent.childIds.splice(op.atIndex ?? parent.childIds.length, 0, id)
          parent.expanded = true
        }
        break
      }
      case 'rename':
        if (p.nodes[op.id]) p.nodes[op.id].title = op.title
        break
      case 'setProjectTitle':
        p.title = op.title
        break
      case 'move': {
        const node = p.nodes[op.id]
        if (!node || op.id === op.newParentId) break
        if (op.newParentId != null && this.descendants(p, op.id).includes(op.newParentId)) break
        if (node.parentId == null) p.rootIds = p.rootIds.filter(x => x !== op.id)
        else { const old = p.nodes[node.parentId]; if (old) old.childIds = old.childIds.filter(x => x !== op.id) }
        node.parentId = op.newParentId
        if (op.newParentId == null) p.rootIds.splice(op.atIndex, 0, op.id)
        else { const np = p.nodes[op.newParentId]; if (np) { np.childIds.splice(op.atIndex, 0, op.id); np.expanded = true } }
        break
      }
      case 'duplicate': {
        const cloneRec = async (srcId: string, parentId: string | null): Promise<string> => {
          const src = p.nodes[srcId]
          const nid = uid(src.type)
          p.nodes[nid] = { ...src, id: nid, parentId, childIds: [], title: src.title + ' copy', meta: { ...src.meta }, ext: { ...src.ext } }
          if (p.docs[srcId]) {
            const content = p.docs[srcId].content
            p.docs[nid] = { content, snapshots: [] }
            await writeText(h, content, 'docs', `${nid}.md`)
          }
          p.nodes[nid].childIds = await Promise.all(src.childIds.map(c => cloneRec(c, nid)))
          return nid
        }
        const src = p.nodes[op.id]
        const newId = await cloneRec(op.id, src.parentId)
        if (src.parentId == null) { const i = p.rootIds.indexOf(op.id); p.rootIds.splice(i + 1, 0, newId) }
        else { const par = p.nodes[src.parentId]; const i = par.childIds.indexOf(op.id); par.childIds.splice(i + 1, 0, newId) }
        break
      }
      case 'trash': {
        const node = p.nodes[op.id]
        if (!node || !p.trashId || node.parentId === p.trashId) break
        if (node.parentId == null) p.rootIds = p.rootIds.filter(x => x !== op.id)
        else { const old = p.nodes[node.parentId]; if (old) old.childIds = old.childIds.filter(x => x !== op.id) }
        node.parentId = p.trashId
        p.nodes[p.trashId].childIds.push(op.id)
        p.nodes[p.trashId].expanded = true
        break
      }
      case 'delete': {
        const kill = [op.id, ...this.descendants(p, op.id)]
        const node = p.nodes[op.id]
        if (!node) break
        if (node.parentId == null) p.rootIds = p.rootIds.filter(x => x !== op.id)
        else { const old = p.nodes[node.parentId]; if (old) old.childIds = old.childIds.filter(x => x !== op.id) }
        for (const k of kill) {
          await removeFile(h, 'docs', `${k}.md`)
          delete p.nodes[k]; delete p.docs[k]
        }
        break
      }
      case 'updateMeta':
        if (p.nodes[op.id]) p.nodes[op.id].meta = { ...p.nodes[op.id].meta, ...op.patch }
        break
      case 'setExpanded':
        if (p.nodes[op.id]) p.nodes[op.id].expanded = op.expanded
        break
      case 'setTree':
        // Undo/redo: replace the whole tree; docs are left untouched.
        p.rootIds = op.rootIds
        p.nodes = op.nodes
        break
    }
  }

  // ── Snapshots ─────────────────────────────────────────────────────────────

  async takeSnapshot(projectId: string, nodeId: string, title = '', kind: 'manual' | 'auto' = 'manual'): Promise<Snapshot> {
    const h = this.getHandle(projectId)
    const p = this.getProject(projectId)
    const content = p.docs[nodeId]?.content ?? ''
    const snap: Snapshot = { id: uid('snap'), title, takenAt: new Date().toISOString(), content, words: wordCount(content), kind }
    await writeText(h, content, 'snapshots', nodeId, `${snap.id}.md`)
    if (!p.docs[nodeId]) p.docs[nodeId] = { content, snapshots: [] }
    // Store metadata only in manifest (content in file)
    p.docs[nodeId].snapshots = [{ ...snap, content: '' }, ...p.docs[nodeId].snapshots]
    p.modified = new Date().toISOString()
    await this.writeManifest(h, p)
    return snap
  }

  async restoreSnapshot(projectId: string, nodeId: string, snapshotId: string): Promise<{ content: string; snapshot: Snapshot }> {
    const h = this.getHandle(projectId)
    const content = await readText(h, 'snapshots', nodeId, `${snapshotId}.md`)
    if (content === null) throw new Error('Snapshot file not found')
    await this.takeSnapshot(projectId, nodeId, 'before restore')
    await this.writeDoc(projectId, nodeId, content)
    const p = this.getProject(projectId)
    const meta = p.docs[nodeId]?.snapshots.find(s => s.id === snapshotId)
    return { content, snapshot: meta ? { ...meta, content } : { id: snapshotId, title: '', takenAt: new Date().toISOString(), content, words: wordCount(content) } }
  }

  async listSnapshots(projectId: string, nodeId: string): Promise<Snapshot[]> {
    const h = this.getHandle(projectId)
    const p = this.getProject(projectId)
    const metas = p.docs[nodeId]?.snapshots ?? []
    return Promise.all(metas.map(async m => {
      const content = await readText(h, 'snapshots', nodeId, `${m.id}.md`) ?? ''
      return { ...m, content }
    }))
  }

  async deleteSnapshot(projectId: string, nodeId: string, snapshotId: string): Promise<void> {
    const h = this.getHandle(projectId)
    const p = this.getProject(projectId)
    await removeFile(h, 'snapshots', nodeId, `${snapshotId}.md`)
    if (p.docs[nodeId]) p.docs[nodeId].snapshots = p.docs[nodeId].snapshots.filter(s => s.id !== snapshotId)
    await this.writeManifest(h, p)
  }

  // ── Compile ───────────────────────────────────────────────────────────────

  async compile(projectId: string, rootId: string, includedIds: string[], format: CompileFormat): Promise<CompileResult> {
    const h = this.getHandle(projectId)
    const p = this.getProject(projectId)
    const chapters: Array<{ title: string; content: string }> = []
    const gather = async (id: string) => {
      const node = p.nodes[id]
      if (!node) return
      if (node.type !== 'folder' && includedIds.includes(id)) {
        const content = p.docs[id]?.content ?? await readText(h, 'docs', `${id}.md`) ?? ''
        if (content.trim()) chapters.push({ title: node.title, content: content.trim() })
      }
      for (const cid of node.childIds) await gather(cid)
    }
    await gather(rootId)
    const projectTitle = p.title.replace(/[<>:"/\\|?*]/g, '_')

    if (format === 'markdown') {
      const combined = chapters.map(c => c.content).join('\n\n---\n\n')
      return { blob: new TextEncoder().encode(combined), filename: `${projectTitle}.md`, format: 'markdown' }
    }
    if (format === 'epub') {
      const { buildEpub } = await import('@shared/epubBuilder')
      const blob = await buildEpub({
        title: p.title,
        chapters: chapters.map((c, i) => ({
          id: `ch_${String(i + 1).padStart(4, '0')}`,
          title: c.title,
          markdown: c.content,
        })),
      })
      return { blob, filename: `${projectTitle}.epub`, format: 'epub' }
    }
    const combined = chapters.map(c => c.content).join('\n\n---\n\n')
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

  // ── Helpers ───────────────────────────────────────────────────────────────

  recents(): Array<{ id: string; title: string; location: string; words: number }> {
    return [] // handled by RecentsService
  }

  private getHandle(projectId: string): FileSystemDirectoryHandle {
    const h = this.handles.get(projectId)
    if (!h) throw new Error(`Project not open: ${projectId}`)
    return h
  }

  private getProject(projectId: string): Project {
    const p = this.projects.get(projectId)
    if (!p) throw new Error(`Project not in cache: ${projectId}`)
    return p
  }

  async saveSettings(projectId: string, patch: Partial<import('@shared/types').ProjectSettings>): Promise<void> {
    const h = this.getHandle(projectId)
    const p = this.getProject(projectId)
    Object.assign(p.settings, patch)
    p.modified = new Date().toISOString()
    await this.writeManifest(h, p)
  }

  async saveCodex(projectId: string, entries: import('@shared/types').CodexEntry[]): Promise<void> {
    const h = this.getHandle(projectId)
    const p = this.getProject(projectId)
    p.settings.codex = entries
    p.modified = new Date().toISOString()
    await this.writeManifest(h, p)
  }

  // ── Aux files ─────────────────────────────────────────────────────────────

  async readAux(projectId: string, name: string): Promise<string | null> {
    if (!isValidAuxName(name)) throw new Error(`Invalid aux file name: ${name}`)
    const h = this.getHandle(projectId)
    return readText(h, 'aux', name)
  }

  async writeAux(projectId: string, name: string, content: string): Promise<void> {
    if (!isValidAuxName(name)) throw new Error(`Invalid aux file name: ${name}`)
    const h = this.getHandle(projectId)
    await writeText(h, content, 'aux', name)
  }

  async removeAux(projectId: string, name: string): Promise<void> {
    if (!isValidAuxName(name)) throw new Error(`Invalid aux file name: ${name}`)
    const h = this.getHandle(projectId)
    await removeFile(h, 'aux', name)
  }

  private async writeManifest(h: FileSystemDirectoryHandle, project: Project): Promise<void> {
    const slim = {
      ...project,
      docs: Object.fromEntries(
        Object.entries(project.docs).map(([k, v]) => [k, { snapshots: v.snapshots.map(s => ({ ...s, content: '' })) }])
      ),
    }
    await writeText(h, JSON.stringify(slim, null, 2), 'project.json')
  }

  private descendants(p: Project, id: string): string[] {
    const acc: string[] = []
    const walk = (i: string) => { for (const c of p.nodes[i]?.childIds ?? []) { acc.push(c); walk(c) } }
    walk(id)
    return acc
  }
}

export const opfsProjectService = new OPFSProjectService()
