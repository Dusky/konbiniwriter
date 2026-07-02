// ─────────────────────────────────────────────────────────────────────────────
// shared/types.ts — canonical data model. Imported by main AND renderer.
// ─────────────────────────────────────────────────────────────────────────────

export type ID = string
export type ISO = string

export type NodeType = 'folder' | 'document' | 'scene'
export type StatusId = 'idea' | 'todo' | 'inprogress' | 'draft' | 'revised' | 'final'
export type LabelId = 'none' | 'scene' | 'chapter' | 'note' | 'character' | 'idea'
export type TemplateId = 'blank' | 'novel' | 'screenplay' | 'nonfiction'
export type ViewMode = 'editor' | 'corkboard' | 'outliner' | 'timeline'
export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error'
export type CompileFormat = 'markdown' | 'docx' | 'print' | 'epub'
export type ModalId =
  | 'new-project'
  | 'open-project'
  | 'command-palette'
  | 'history'
  | 'compile'
  | 'shortcuts'
  | 'about'
  | 'prefs'
  | 'search'
  | 'prompt-registry'
  | 'codex'
  | 'ai-settings'
  | 'batch-generator'
  | 'bestof'
  | 'stats'
  | 'autopilot'
  | 'foundation'
  | 'debt'
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
  wordTarget?: number        // project-level word-count goal
  codex?: CodexEntry[]       // stored as JSON, typed at load time
  debt?: DebtItem[]          // propagation-debt inbox (persisted with project)
  voiceFingerprint?: string  // foundation: prose style guide, injected as context
  autopilotRun?: AutopilotRunState | null  // in-progress autopilot run, for resume
  [k: string]: unknown
}

// A persisted Autopilot run so an interrupted run (stop, close, refresh) can be
// resumed from where it left off. Cleared on natural completion or discard.
export interface AutopilotRunState {
  promptId: string
  useGate: boolean
  queue: ID[]      // ordered node IDs this run is processing
  doneIds: ID[]    // nodes whose proposal has already been resolved
  startedAt: ISO
}

// ── Propagation debt ──────────────────────────────────────────────────────────
// A change in one layer (e.g. a Codex canon fact) leaves downstream documents
// stale. Each DebtItem records the change and the documents it may have
// invalidated, so the author can review/redraft them through the proposal pipe.

export type DebtLayer = 'voice' | 'world' | 'character' | 'outline' | 'prose' | 'canon'

export interface DebtAffected {
  docId: ID
  note: string          // why this doc is implicated, e.g. a matched snippet
  resolved: boolean
}

export interface DebtItem {
  id: ID
  layer: DebtLayer
  title: string         // e.g. "Mara · age changed"
  detail: string        // what changed, e.g. '"29" → "31"'
  source: string        // entity id (or doc id) that caused the change
  affected: DebtAffected[]
  createdAt: ISO
  // Structured change context for AI-assisted reconciliation (canon debt).
  revision?: { entityName: string; factLabel: string; oldValue: string; newValue: string }
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
  kind?: 'manual' | 'auto'   // absent = manual (back-compat with older bundles)
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
  | { type: 'setTree'; rootIds: ID[]; nodes: Record<ID, KNode> }  // undo/redo restore

// ── Proposal / Changeset (Phase 2 spine — defined here so the seam is clear) ─

export type ProposalCommand =
  | 'lineedit' | 'rewrite' | 'expand' | 'tighten' | 'describe' | 'brainstorm'
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
  // If this proposal was generated to resolve a propagation-debt item, applying
  // it auto-resolves that affected document.
  debtRef?: { debtId: ID; docId: ID }
  // 'selection' proposals carry `original`/`proposed` for just the selected
  // text; applying them splices the resolved text back into the document at
  // `selRange` (or by locating `original` if the range has shifted). Absent
  // or 'document' means `original`/`proposed` are the whole document.
  scope?: 'selection' | 'document'
  selRange?: { from: number; to: number }
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

// ── Codex ─────────────────────────────────────────────────────────────────────

export type CodexCategory = 'character' | 'location' | 'item' | 'concept' | 'lore'

export interface CodexFact {
  id: ID
  label: string
  value: string
  aiGenerated: boolean
  confirmedAt: ISO | null
}

export interface CodexEntry {
  id: ID
  name: string
  aliases: string[]         // all lowercased; used by MentionIndex
  category: CodexCategory
  summary: string           // AI-generated overview, editable
  facts: CodexFact[]
  imagePrompt?: string
  createdAt: ISO
  modifiedAt: ISO
  aiGenerated: boolean
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
    openRecent(id: ID, location: string): Promise<Project>
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
    take(projectId: ID, nodeId: ID, title?: string, kind?: 'manual' | 'auto'): Promise<Snapshot>
    restore(projectId: ID, nodeId: ID, snapshotId: ID): Promise<{ content: string; snapshot: Snapshot }>
    list(projectId: ID, nodeId: ID): Promise<Snapshot[]>
    delete(projectId: ID, nodeId: ID, snapshotId: ID): Promise<void>
  }
  codex: {
    save(projectId: ID, entries: CodexEntry[]): Promise<void>
  }
  settings: {
    save(projectId: ID, patch: Partial<ProjectSettings>): Promise<void>
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
    /** Subscribe to maximize/unmaximize from any source (button, OS, double-click). Returns an unsubscribe fn. */
    onMaximizeChange?(cb: (maximized: boolean) => void): () => void
  }
  /** Global key-value preference store. Synchronous so stores can hydrate at construction time. */
  prefs: {
    get(key: string): string | null
    set(key: string, value: string): void
    remove(key: string): void
  }
  /** Per-project auxiliary files (e.g. chat history) stored under <bundle>/aux/<name>. */
  aux: {
    read(projectId: ID, name: string): Promise<string | null>
    write(projectId: ID, name: string, content: string): Promise<void>
    remove(projectId: ID, name: string): Promise<void>
  }
}
