// ─────────────────────────────────────────────────────────────────────────────
// shared/types.ts — canonical data model. Imported by main AND renderer.
// ─────────────────────────────────────────────────────────────────────────────

import type { Comment } from './comments'
import type { Collection } from './query'

export type ID = string
export type ISO = string

export type NodeType = 'folder' | 'document' | 'scene'
export type StatusId = 'idea' | 'todo' | 'inprogress' | 'draft' | 'revised' | 'final'
export type LabelId = 'none' | 'scene' | 'chapter' | 'note' | 'character' | 'idea'
export type TemplateId = 'blank' | 'novel' | 'screenplay' | 'nonfiction'
export type ViewMode = 'editor' | 'corkboard' | 'outliner' | 'timeline'
export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error'
export type CompileFormat = 'markdown' | 'docx' | 'shunn' | 'print' | 'epub'
export type ModalId =
  | 'new-project'
  | 'open-project'
  | 'command-palette'
  | 'compile'
  | 'shortcuts'
  | 'about'
  | 'search'
  | 'debt'
  | null

// ── Project ───────────────────────────────────────────────────────────────────

export interface Project {
  schemaVersion: 2
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
  author?: string            // book metadata: used by every export format
  language?: string          // BCP-47 tag for EPUB (defaults to 'en')
  accent?: string
  editorFont?: 'mono' | 'serif' | 'sans'
  editorSize?: number
  wordTarget?: number        // project-level word-count goal
  codex?: CodexEntry[]       // stored as JSON, typed at load time
  debt?: DebtItem[]          // propagation-debt inbox (persisted with project)
  comments?: Comment[]       // margin notes anchored to spans of prose (sidecar)
  collections?: Collection[]  // saved binder queries
  dictionary?: string[]      // words the writer marked correct (project vocabulary)
  /**
   * Named prose style guides. A book with two POV voices needs two, and a
   * document can point at one that isn't the project default.
   */
  voiceProfiles?: VoiceProfile[]
  /** Which profile applies to documents that don't name their own. */
  activeVoiceId?: ID
  /**
   * The active profile's text, mirrored here.
   *
   * This was the whole feature before profiles existed, and it is still what a
   * bundle written by an older build carries. Kept in sync on every profile
   * change so downgrading, or reading the manifest with anything else, still
   * finds the voice that was in force. `resolveVoice()` is the read path —
   * nothing should reach for this field directly.
   */
  voiceFingerprint?: string
  aiInstructions?: string    // per-project AI instructions & notes (CLAUDE.md analog)
  autopilotRun?: AutopilotRunState | null  // in-progress autopilot run, for resume
  [k: string]: unknown
}

/**
 * A named prose style guide.
 *
 * `fingerprint` is the same markdown a single-voice project used to keep in
 * `settings.voiceFingerprint`; the name is what makes a second one usable.
 */
export interface VoiceProfile {
  id: ID
  name: string
  fingerprint: string
  createdAt: ISO
  modifiedAt: ISO
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
  /**
   * Lamport revision — one past the highest rev seen in the project when this
   * node last changed. Cross-device sync merges the node tree per-node rather
   * than whole-file, and compares by `rev` because wall clocks skew between
   * machines. Backfilled to 1 when migrating a schemaVersion-1 bundle.
   */
  rev: number
  /** ISO time this node last changed. Display + tiebreak only; `rev` decides. */
  modified: ISO
}

export interface DocMeta {
  label: LabelId
  status: StatusId
  synopsis: string
  target: number
  includeInCompile: boolean
  /**
   * Free-form tags used to query the binder ("mira", "pov-alex", "needs-research").
   * Optional so bundles written before keywords existed load without migration —
   * read it as `keywords ?? []`.
   */
  keywords?: string[]
  /**
   * Which voice profile this document is written in. Undefined means "the
   * project's active profile" — the common case, and what every document in a
   * single-voice book carries.
   */
  voiceId?: ID
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

/** A bundle as it currently exists on disk. */
export interface SyncBundle {
  rootIds: ID[]
  nodes: Record<ID, KNode>
  docs: Record<ID, { content: string }>
}

/** The outcome of a merge, ready to persist. */
export interface SyncMerged {
  rootIds: ID[]
  nodes: Record<ID, KNode>
  /** docId → final content to write. */
  docs: Record<ID, string>
  /** docId → divergent text to preserve beside the document. */
  conflicts: Record<ID, string>
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
  // Batch variants: one round trip and one manifest write for a multi-selection.
  | { type: 'updateMetaMany'; ids: ID[]; patch: Partial<DocMeta> }
  | { type: 'trashMany'; ids: ID[] }
  | { type: 'deleteMany'; ids: ID[] }

// ── Proposal / Changeset (Phase 2 spine — defined here so the seam is clear) ─

export type ProposalCommand =
  | 'lineedit' | 'rewrite' | 'expand' | 'tighten' | 'describe' | 'brainstorm'
  | 'chat' | 'draft' | 'foundation' | 'revision' | 'batch' | 'beat'

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

/** Result of an OAuth token exchange/refresh, normalized across backends. */
export interface OAuthTokenResult {
  ok: boolean
  accessToken?: string
  refreshToken?: string
  /** Lifetime in seconds, as returned by the token endpoint. */
  expiresIn?: number
  error?: string
}

/** Callbacks for a streamed OAuth Messages API call (proxied through the platform). */
export interface OAuthStreamHandlers {
  /** Raw SSE text as it arrives (the caller parses it). */
  onChunk: (text: string) => void
  onDone: () => void
  onError: (err: { status?: number; body?: string }) => void
  onAbort?: () => void
}

/** One imported source file. `path` is relative, e.g. "Part 1/ch1.md". */
export interface ImportDoc {
  path: string
  content: string
  /** Corkboard synopsis, when the source has one (e.g. Scrivener). */
  synopsis?: string
}

export interface KonbiniAPI {
  project: {
    create(opts: { title: string; template: TemplateId; location: string }): Promise<Project>
    /** Build a new project bundle from imported files (renderer reads the sources). */
    import(opts: { title: string; location: string; docs: ImportDoc[] }): Promise<Project>
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
    /**
     * Subscribe to external-edit conflicts: when a doc was changed on disk by
     * another program and the app's next save preserved that version as a
     * `.conflict-<ts>.md` backup. Electron only (real files); returns an
     * unsubscribe fn. Absent on backends without real external writers.
     */
    onConflict?(cb: (e: { projectId: ID; nodeId: ID; file: string }) => void): () => void
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
  debt: {
    save(projectId: ID, items: DebtItem[]): Promise<void>
  }
  comments: {
    save(projectId: ID, comments: Comment[]): Promise<void>
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
    /** Open a URL in the user's default browser (used by the Claude OAuth sign-in). */
    openExternal(url: string): void
  }
  /**
   * OAuth token endpoint proxy for "Sign in with Claude". The token endpoint
   * sends no CORS headers, so the Electron build routes these through the main
   * process; the browser build calls it directly (best-effort). See ClaudeOAuth.ts.
   */
  oauth: {
    exchange(input: { code: string; state: string; verifier: string; redirectUri: string }): Promise<OAuthTokenResult>
    refresh(input: { refreshToken: string }): Promise<OAuthTokenResult>
    /**
     * Stream a Messages API call authenticated with a subscription (OAuth) token.
     * Subscription tokens are first-party/server-side only — a renderer request
     * carries a browser Origin that Anthropic rejects — so the Electron build
     * proxies this through the main process. Returns an abort handle.
     */
    streamMessages(input: { token: string; body: unknown }, handlers: OAuthStreamHandlers): { abort: () => void }
  }
  /**
   * Run a local CLI agent (opencode, Claude Code, etc.) inside the open project's
   * folder, streaming its stdout. The agent edits the project's files DIRECTLY on
   * disk — it does not go through changeset review. Electron only (spawns a
   * process); absent in the browser build. Returns an abort handle.
   */
  agent?: {
    run(
      input: { projectId: ID; command: string; prompt: string },
      handlers: { onChunk: (text: string) => void; onDone: (code: number) => void; onError: (err: string) => void; onAbort?: () => void },
    ): { abort: () => void }
  }
  /**
   * The platform's own spellchecker dictionary.
   *
   * Absent in the browser: a web page can ask for squiggles but cannot add a
   * word to the dictionary behind them, so there is nothing honest to
   * implement. Present in Electron, where the session exposes it — though on
   * platforms that defer to the OS dictionary (macOS) the add is a no-op there
   * too. Konbini's own name check (shared/dictionary.ts) works either way.
   */
  spell?: {
    addWord(word: string): void
    removeWord(word: string): void
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
  /** Cross-device sync (Tier 0: a bundle an external syncer may have changed). */
  sync: {
    /**
     * Cheap change-detector: file → mtime for the manifest and every doc.
     * Compared against the previous probe to decide whether a full read is
     * even worth doing.
     */
    probe(projectId: ID): Promise<Record<string, number>>
    /** Re-read the bundle from disk, bypassing the in-memory cache. */
    readBundle(projectId: ID): Promise<SyncBundle>
    /**
     * Persist a merged result: doc bodies, the node tree, and one
     * `<id>.conflict-<stamp>.md` per preserved divergence.
     * @returns the conflict filenames written.
     */
    applyMerge(projectId: ID, merged: SyncMerged): Promise<string[]>
  }
}
