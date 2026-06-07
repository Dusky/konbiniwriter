// ─────────────────────────────────────────────────────────────────────────────
// shared/types.ts — canonical data model. Imported by main AND renderer.
// ─────────────────────────────────────────────────────────────────────────────

export type ID = string
export type ISO = string

export type NodeType = 'folder' | 'document' | 'scene'
export type StatusId = 'idea' | 'todo' | 'inprogress' | 'draft' | 'revised' | 'final'
export type LabelId = 'none' | 'scene' | 'chapter' | 'note' | 'character' | 'idea'
export type TemplateId = 'blank' | 'novel' | 'screenplay' | 'nonfiction'
export type ViewMode = 'editor' | 'corkboard' | 'outliner'
export type SaveStatus = 'saved' | 'saving' | 'unsaved'
export type CompileFormat = 'markdown' | 'docx'
export type ModalId =
  | 'new-project'
  | 'open-project'
  | 'snapshot'
  | 'compile'
  | 'shortcuts'
  | 'about'
  | 'prefs'
  | null

// ── Project ───────────────────────────────────────────────────────────────────

export interface Project {
  schemaVersion: 1
  id: ID
  title: string
  created: ISO
  modified: ISO
  rootIds: ID[]
  trashId: ID | null
  nodes: Record<ID, KNode>
  docs: Record<ID, DocBody>
  settings: ProjectSettings
}

export interface ProjectSettings {
  location: string
  template?: TemplateId
  accent?: string
  editorFont?: 'mono' | 'serif' | 'sans'
  editorSize?: number
  [k: string]: unknown
}

export interface KNode {
  id: ID
  type: NodeType
  title: string
  parentId: ID | null
  childIds: ID[]
  expanded: boolean
  meta: DocMeta
  ext: Record<string, unknown>
}

export interface DocMeta {
  label: LabelId
  status: StatusId
  synopsis: string
  target: number
  includeInCompile: boolean
}

export interface DocBody {
  content: string
  snapshots: Snapshot[]
}

export interface Snapshot {
  id: ID
  title: string
  takenAt: ISO
  content: string
  words: number
}

// ── Recents ───────────────────────────────────────────────────────────────────

export interface RecentEntry {
  id: ID
  title: string
  location: string
  opened: number
  words: number
  template?: TemplateId
  accent?: string
}

// ── Node mutation ops (discriminated union) ───────────────────────────────────

export type NodeOp =
  | { type: 'create'; parentId: ID | null; nodeType: NodeType; title?: string; atIndex?: number }
  | { type: 'rename'; id: ID; title: string }
  | { type: 'move'; id: ID; newParentId: ID | null; atIndex: number }
  | { type: 'duplicate'; id: ID }
  | { type: 'trash'; id: ID }
  | { type: 'delete'; id: ID }
  | { type: 'updateMeta'; id: ID; patch: Partial<DocMeta> }
  | { type: 'setExpanded'; id: ID; expanded: boolean }
  | { type: 'setProjectTitle'; title: string }

// ── Proposal / Changeset (Phase 2 spine — defined here so the seam is clear) ─

export type ProposalCommand =
  | 'lineedit' | 'rewrite' | 'expand' | 'tighten' | 'describe'
  | 'chat' | 'draft' | 'foundation' | 'revision' | 'batch'

export type ProposalStatus = 'pending' | 'applied' | 'discarded'

export interface Proposal {
  id: ID
  docId: ID
  docTitle: string
  command: ProposalCommand
  label: string
  group: string
  original: string
  proposed: string
  createdAt: ISO
  accepted: number[]
  nHunks: number
  status: ProposalStatus
  seq: number
  costEstimateCents?: number
  promptId?: string
  agentId?: string
}

export type DiffSegment =
  | { type: 'ctx'; lines: string[] }
  | { type: 'hunk'; idx: number; del: string[]; add: string[] }

// ── PromptRegistry / AgentRegistry (Phase 2 — schemas defined now) ────────────

export type PromptFeature =
  | 'inline' | 'chat' | 'codex' | 'batch' | 'evaluation' | 'autopilot'

export type AutopilotPhase = 'foundation' | 'draft' | 'eval' | 'revise'

export interface PromptVariable {
  name: string
  description: string
  example?: string
}

export interface PromptTemplate {
  id: string
  name: string
  description: string
  feature: PromptFeature
  phase?: AutopilotPhase
  model: string
  temperature: number
  maxTokens?: number
  template: string
  variables: PromptVariable[]
  isBuiltin: boolean
  parentId?: string
  createdAt: ISO
  modifiedAt: ISO
}

export type AgentCategory = 'reader' | 'critic' | 'judge' | 'codex' | 'autopilot'

export interface AgentTemplate {
  id: string
  name: string
  description: string
  category: AgentCategory
  systemPromptId: string
  model: string
  temperature: number
  parameters: Record<string, unknown>
  isBuiltin: boolean
  parentId?: string
  createdAt: ISO
  modifiedAt: ISO
}

// ── Compile result ────────────────────────────────────────────────────────────

export interface CompileResult {
  blob: Uint8Array
  filename: string
  format: CompileFormat
}

// ── IPC API shape (mirrored in preload) ──────────────────────────────────────

export interface KonbiniAPI {
  project: {
    create(opts: { title: string; template: TemplateId; location: string }): Promise<Project>
    open(path: string): Promise<Project>
    recents(): Promise<RecentEntry[]>
    close(id: ID): Promise<void>
    removeRecent(id: ID): Promise<void>
    showOpenDialog(): Promise<string | null>
    showSaveDialog(defaultName: string): Promise<string | null>
  }
  doc: {
    read(projectId: ID, nodeId: ID): Promise<string>
    write(projectId: ID, nodeId: ID, content: string): Promise<void>
  }
  node: {
    mutate(projectId: ID, op: NodeOp): Promise<{ rootIds: ID[]; nodes: Record<ID, KNode>; docs: Record<ID, DocBody> }>
  }
  snapshot: {
    take(projectId: ID, nodeId: ID, title?: string): Promise<Snapshot>
    restore(projectId: ID, nodeId: ID, snapshotId: ID): Promise<{ content: string; snapshot: Snapshot }>
    list(projectId: ID, nodeId: ID): Promise<Snapshot[]>
    delete(projectId: ID, nodeId: ID, snapshotId: ID): Promise<void>
  }
  compile: {
    run(projectId: ID, rootId: ID, includedIds: ID[], format: CompileFormat): Promise<CompileResult>
  }
  shell: {
    platform: 'darwin' | 'win32' | 'linux'
    minimize(): void
    maximize(): void
    close(): void
    isMaximized(): Promise<boolean>
  }
}
