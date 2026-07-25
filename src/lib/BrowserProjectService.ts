// BrowserProjectService — File System Access API implementation of the project layer.
//
// Electron migration path: replace FileSystemDirectoryHandle ops with fs/promises
// equivalents in a NodeProjectService that satisfies the same interface.
//
// "path" strings throughout are opaque keys into this.handles; components never
// see real filesystem paths (same story in Electron where they'd be real paths).

import type { Project, KNode, DocBody, NodeOp, Snapshot, ID, ImportDoc, CompileFormat, CompileResult, SyncBundle, SyncMerged } from '@shared/types'
import { uid, wordCount, isValidAuxName } from '@shared/utils'
import { buildProjectFromTemplate } from '@shared/templates'
import { buildProjectFromDocs } from '@shared/importer'
import { handleStore } from './HandleStore'
import { applyNodeOp, migrateProject } from '@shared/nodeOps'
import { serializeManifest, serializeCodex, serializeDebt, adoptSidecars, CODEX_FILE, DEBT_FILE } from '@shared/bundle'
import { conflictFileName } from '@shared/sync'

// FSA permission methods aren't in the base DOM lib types yet.
type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission?(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
}

function requireFSA(): void {
  if (!isFileSystemAccessSupported()) {
    throw new Error('File System Access API not supported. Please use Chrome or Edge 86+.')
  }
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

export class BrowserProjectService {
  // Bundle handles for open projects (key = project.id)
  private handles = new Map<string, FileSystemDirectoryHandle>()
  // In-memory project state cache
  private projects = new Map<string, Project>()
  // Temp handles from picker dialogs (key = opaque token returned to caller)
  private tempHandles = new Map<string, FileSystemDirectoryHandle>()

  // ── Dialog helpers (return opaque keys; components pass them back) ─────────

  async showOpenDialog(): Promise<string | null> {
    requireFSA()
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
      const key = uid('dh')
      this.tempHandles.set(key, handle)
      return key
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null
      throw e
    }
  }

  async showSaveDialog(_defaultName: string): Promise<string | null> {
    requireFSA()
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
      const key = uid('ph')
      this.tempHandles.set(key, handle)
      return `${key}::${handle.name}`
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null
      throw e
    }
  }

  getHandleDisplayName(key: string): string {
    const h = this.tempHandles.get(key.split('::')[0])
    return h ? h.name : key
  }

  // ── Open ─────────────────────────────────────────────────────────────────

  async open(handleKey: string): Promise<Project> {
    const bundleHandle = this.tempHandles.get(handleKey) ?? this.handles.get(handleKey)
    if (!bundleHandle) throw new Error('No directory handle for key: ' + handleKey)
    const project = await this.loadFromHandle(bundleHandle)
    this.tempHandles.delete(handleKey)
    return project
  }

  // Reopen a recent project directly from its persisted FSA handle, skipping the
  // folder picker. Returns null if no handle is stored or permission is denied
  // (the caller then falls back to the picker).
  async openByHandle(projectId: string): Promise<Project | null> {
    const handle = (await handleStore.get(projectId)) as PermissionHandle | undefined
    if (!handle) return null
    const opts = { mode: 'readwrite' as const }
    let perm = (await handle.queryPermission?.(opts)) ?? 'prompt'
    if (perm !== 'granted') perm = (await handle.requestPermission?.(opts)) ?? 'denied'
    if (perm !== 'granted') return null
    try {
      return await this.loadFromHandle(handle)
    } catch {
      // Bundle moved/deleted — forget the stale handle.
      void handleStore.del(projectId)
      return null
    }
  }

  // Shared core: read the manifest + doc bodies from a resolved bundle handle,
  // register it under the project id, and persist it for future quick-reopen.
  private async loadFromHandle(bundleHandle: FileSystemDirectoryHandle): Promise<Project> {
    const manifestText = await readText(bundleHandle, 'project.json')
    if (!manifestText) throw new Error('Not a Konbini project (no project.json)')

    const project: Project = JSON.parse(manifestText)
    // Upgrade an older bundle once, on open, so the file on disk stops
    // lagging what we hold in memory.
    const didMigrate = migrateProject(project)
    // Codex/debt live in sidecar files so sync can merge them apart from
    // the manifest; older bundles still carry them inline.
    const owesSidecars = adoptSidecars(
      project,
      await readText(bundleHandle, CODEX_FILE),
      await readText(bundleHandle, DEBT_FILE),
    )

    // Eagerly load all doc content
    for (const nodeId of Object.keys(project.docs)) {
      const content = await readText(bundleHandle, 'docs', `${nodeId}.md`)
      project.docs[nodeId] = { content: content ?? '', snapshots: project.docs[nodeId]?.snapshots ?? [] }
    }

    // Promote handle to a stable slot keyed by project.id, and persist it.
    this.handles.set(project.id, bundleHandle)
    this.projects.set(project.id, project)
    void handleStore.put(project.id, bundleHandle)
    if (didMigrate || owesSidecars) {
      await writeText(bundleHandle, serializeCodex(project.settings.codex ?? []), CODEX_FILE)
      await writeText(bundleHandle, serializeDebt(project.settings.debt ?? []), DEBT_FILE)
      await this.writeManifest(bundleHandle, project)
    }
    return project
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async create(opts: { title: string; template: 'blank' | 'novel' | 'screenplay' | 'nonfiction'; location: string }): Promise<Project> {
    // location may be a pre-picked parent handle key OR we open the picker now
    const [parentKey] = opts.location.split('::')
    let parentHandle = this.tempHandles.get(parentKey)

    if (!parentHandle) {
      requireFSA()
      try {
        parentHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw new Error('No folder selected.')
        throw e
      }
    }

    const bundleName = `${opts.title.replace(/[<>:"/\\|?*]/g, '_')}.konbini`
    const bundleHandle = await parentHandle.getDirectoryHandle(bundleName, { create: true })

    // Ensure subdirs
    await bundleHandle.getDirectoryHandle('docs', { create: true })
    await bundleHandle.getDirectoryHandle('snapshots', { create: true })

    const project = buildProjectFromTemplate(opts.title, opts.template, `${parentHandle.name}/${bundleName}`)

    // Write all doc .md files
    for (const [nodeId, body] of Object.entries(project.docs)) {
      if (body.content) {
        await writeText(bundleHandle, body.content, 'docs', `${nodeId}.md`)
      }
    }

    await this.writeManifest(bundleHandle, project)
    this.handles.set(project.id, bundleHandle)
    this.tempHandles.delete(parentKey)
    this.projects.set(project.id, project)
    void handleStore.put(project.id, bundleHandle)
    return project
  }

  async import(opts: { title: string; location: string; docs: ImportDoc[] }): Promise<Project> {
    const [parentKey] = opts.location.split('::')
    let parentHandle = this.tempHandles.get(parentKey)
    if (!parentHandle) {
      requireFSA()
      try {
        parentHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw new Error('No folder selected.')
        throw e
      }
    }
    const bundleName = `${opts.title.replace(/[<>:"/\\|?*]/g, '_')}.konbini`
    const bundleHandle = await parentHandle.getDirectoryHandle(bundleName, { create: true })
    await bundleHandle.getDirectoryHandle('docs', { create: true })
    await bundleHandle.getDirectoryHandle('snapshots', { create: true })

    const project = buildProjectFromDocs(opts.title, `${parentHandle.name}/${bundleName}`, opts.docs)
    for (const [nodeId, body] of Object.entries(project.docs)) {
      await writeText(bundleHandle, body.content, 'docs', `${nodeId}.md`)
    }
    await this.writeManifest(bundleHandle, project)
    this.handles.set(project.id, bundleHandle)
    this.tempHandles.delete(parentKey)
    this.projects.set(project.id, project)
    void handleStore.put(project.id, bundleHandle)
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

  /** The only platform-specific half of a node op: doc-file writes and deletes. */
  private nodeIO(h: FileSystemDirectoryHandle) {
    return {
      writeDoc: (nodeId: ID, content: string) => writeText(h, content, 'docs', `${nodeId}.md`),
      removeDoc: (nodeId: ID) => removeFile(h, 'docs', `${nodeId}.md`),
    }
  }

  async mutateNode(projectId: string, op: NodeOp): Promise<{ rootIds: ID[]; nodes: Record<ID, KNode>; docs: Record<ID, DocBody> }> {
    const h = this.getHandle(projectId)
    const p = this.getProject(projectId)
    await applyNodeOp(p, op, this.nodeIO(h))
    p.modified = new Date().toISOString()
    await this.writeManifest(h, p)
    return { rootIds: p.rootIds, nodes: p.nodes, docs: p.docs }
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
    const beforeSnap = await this.takeSnapshot(projectId, nodeId, 'before restore')
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
        author: p.settings.author,
        language: p.settings.language,
        chapters: chapters.map((c, i) => ({
          id: `ch_${String(i + 1).padStart(4, '0')}`,
          title: c.title,
          markdown: c.content,
        })),
      })
      return { blob, filename: `${projectTitle}.epub`, format: 'epub' }
    }
    // docx (readable manuscript) and shunn (agent-submission format)
    const { buildDocx } = await import('@shared/docxBuilder')
    const blob = await buildDocx({
      title: p.title,
      author: p.settings.author,
      style: format === 'shunn' ? 'shunn' : 'manuscript',
      chapters: chapters.map(c => ({ title: c.title, markdown: c.content })),
    })
    const suffix = format === 'shunn' ? '.manuscript.docx' : '.docx'
    return { blob, filename: `${projectTitle}${suffix}`, format }
  }

  // ── Sync (Tier 0) ─────────────────────────────────────────────────────────

  /**
   * Read the bundle straight off disk, ignoring our in-memory copy — this is how
   * we see what an external syncer (Dropbox/iCloud/Syncthing/git) left behind.
   */
  async readBundle(projectId: string): Promise<SyncBundle> {
    const h = this.getHandle(projectId)
    const manifestText = await readText(h, 'project.json')
    if (!manifestText) throw new Error('Bundle has no project.json')
    const onDisk: Project = JSON.parse(manifestText)
    migrateProject(onDisk)   // an older bundle may predate per-node revs
    const docs: Record<ID, { content: string }> = {}
    for (const nodeId of Object.keys(onDisk.docs ?? {})) {
      docs[nodeId] = { content: (await readText(h, 'docs', `${nodeId}.md`)) ?? '' }
    }
    return { rootIds: onDisk.rootIds, nodes: onDisk.nodes, docs }
  }

  /**
   * Persist a merge. Divergent remote text is written beside the document as
   * `<id>.conflict-<stamp>.md` — never discarded — using the same convention as
   * an external-edit conflict, so one resolution surface covers both.
   */
  async applyMerge(projectId: string, merged: SyncMerged): Promise<string[]> {
    const h = this.getHandle(projectId)
    const p = this.getProject(projectId)

    const written: string[] = []
    for (const [docId, text] of Object.entries(merged.conflicts)) {
      const file = conflictFileName(docId)
      await writeText(h, text, 'docs', file)
      written.push(file)
    }

    for (const [docId, content] of Object.entries(merged.docs)) {
      await writeText(h, content, 'docs', `${docId}.md`)
      if (p.docs[docId]) p.docs[docId].content = content
      else p.docs[docId] = { content, snapshots: [] }
    }
    // Drop docs the merge decided are gone.
    for (const docId of Object.keys(p.docs)) {
      if (!merged.nodes[docId]) { delete p.docs[docId]; await removeFile(h, 'docs', `${docId}.md`) }
    }

    p.nodes = merged.nodes
    p.rootIds = merged.rootIds
    p.modified = new Date().toISOString()
    await this.writeManifest(h, p)
    return written
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
    // Sidecar write only — the codex is no longer part of the manifest.
    await writeText(h, serializeCodex(entries), CODEX_FILE)
  }

  async saveDebt(projectId: string, items: import('@shared/types').DebtItem[]): Promise<void> {
    const h = this.getHandle(projectId)
    const p = this.getProject(projectId)
    p.settings.debt = items
    p.modified = new Date().toISOString()
    await writeText(h, serializeDebt(items), DEBT_FILE)
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
    await writeText(h, serializeManifest(project), 'project.json')
  }

  private descendants(p: Project, id: string): string[] {
    const acc: string[] = []
    const walk = (i: string) => { for (const c of p.nodes[i]?.childIds ?? []) { acc.push(c); walk(c) } }
    walk(id)
    return acc
  }
}

export const browserProjectService = new BrowserProjectService()
