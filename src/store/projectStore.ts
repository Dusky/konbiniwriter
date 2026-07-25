import { create } from 'zustand'
import { useShellStore } from './shellStore'
import type { Project, KNode, DocBody, DocMeta, NodeType, ViewMode, SaveStatus, Snapshot, ID, Proposal, CodexEntry, DebtItem, ProjectSettings } from '@shared/types'
import type { Comment, CommentOrigin } from '@shared/comments'
import type { NodeQuery, Collection } from '@shared/query'
import { trimAnchor } from '@shared/comments'
import { uid, wordCount } from '@shared/utils'
import { type MentionIndex, buildIndex, updateIndex } from '../lib/MentionIndex'
import type { JudgeResult, QualityPoint } from '../lib/judge'
import type { SlopResult } from '../lib/slop'
import type { VoiceResult } from '../lib/voice'
import { statsService } from '../lib/StatsService'

/**
 * App-level surfaces that open as tabs in the main pane instead of as modals
 * (settings, dashboards, AI workspaces you keep open beside the manuscript).
 * Distinct from document tabs, which are node IDs.
 */
export type ViewTabId =
  | 'stats' | 'foundation' | 'autopilot' | 'prompt-registry' | 'ai-settings'
  | 'batch-generator' | 'bestof' | 'prefs' | 'themes' | 'quality' | 'sync'

interface ProjectState {
  project: Project | null
  selectedId: ID | null
  /** Documents open as editor tabs, in tab order. selectedId is the active tab. */
  openTabs: ID[]
  /** App-view surfaces open as tabs (Stats, Foundation, …), in tab order. */
  openViewTabs: ViewTabId[]
  /** The active view tab. When non-null the main pane shows it instead of the
   *  editor; selecting a document tab clears it (selectedId is preserved). */
  activeViewTab: ViewTabId | null
  splitId: ID | null
  splitOpen: boolean
  view: ViewMode
  saveStatus: SaveStatus
  lastSaved: string | null
  renamingId: ID | null
  focusMode: boolean
  compositionMode: boolean
  mentionIndex: MentionIndex
  proposals: Proposal[]
  activeProposalId: ID | null
  codex: CodexEntry[]
  debt: DebtItem[]
  comments: Comment[]
  /** Comment the rail should scroll to and flash — cleared once consumed. */
  focusedCommentId: ID | null
  collections: Collection[]
  /** Words the writer has marked correct for this project. */
  dictionary: string[]
  slopSpans: import('../components/editor/extensions').SlopSpan[]
  slopRunning: boolean
  nodeHistory: Array<{ rootIds: ID[]; nodes: Record<ID, KNode> }>
  nodeFuture: Array<{ rootIds: ID[]; nodes: Record<ID, KNode> }>
  sessionWordsAdded: number
  cursor: { line: number; col: number } | null
  // A range to reveal+select in the editor once its doc is active (search jump).
  pendingReveal: { docId: ID; from: number; len: number } | null

  // — project lifecycle —
  loadProject: (p: Project) => void
  unloadProject: () => void

  // — selection & view —
  selectNode: (id: ID | null) => void
  /** Close an open editor tab; if it was active, activate a neighbour. */
  closeTab: (id: ID) => void
  /** Open (or focus) an app-view tab in the main pane. */
  openViewTab: (v: ViewTabId) => void
  /** Focus an already-open app-view tab. */
  selectViewTab: (v: ViewTabId) => void
  /** Close an app-view tab; if it was active, fall back to a neighbour or the editor. */
  closeViewTab: (v: ViewTabId) => void
  setSplitId: (id: ID | null) => void
  toggleSplit: () => void
  setView: (v: ViewMode) => void
  setRenamingId: (id: ID | null) => void
  setFocusMode: (on: boolean) => void
  setCompositionMode: (on: boolean) => void
  setCursor: (c: { line: number; col: number } | null) => void
  setPendingReveal: (r: { docId: ID; from: number; len: number } | null) => void

  // — content (THE single mutation seam) —
  updateContent: (docId: ID, content: string) => void
  setSaveStatus: (s: SaveStatus, lastSaved?: string) => void

  // — structural mutations (optimistic; caller also calls IPC async) —
  applyMutation: (result: { rootIds: ID[]; nodes: Record<ID, KNode>; docs: Record<ID, DocBody> }) => void
  undoMutation: () => boolean   // returns true if undo was available
  redoMutation: () => boolean   // returns true if redo was available
  updateMeta: (nodeId: ID, patch: Partial<DocMeta>) => void
  setProjectTitle: (title: string) => void

  // — snapshots —
  addSnapshot: (nodeId: ID, snap: Snapshot) => void
  removeSnapshot: (nodeId: ID, snapId: ID) => void
  restoreContent: (nodeId: ID, content: string) => void

  // — proposals (Phase 2 AI changeset review) —
  queueProposal: (p: Proposal) => void
  resolveProposal: (id: ID, status: 'applied' | 'discarded') => void
  setActiveProposal: (id: ID | null) => void

  // — codex —
  upsertCodexEntry: (entry: CodexEntry) => void
  deleteCodexEntry: (id: ID) => void

  // — comments (margin notes anchored to spans of prose) —
  /** Create a comment on a range; returns its id. Quote is taken from `content`. */
  addComment: (input: {
    docId: ID; from: number; to: number; body: string
    author?: string; origin?: CommentOrigin; agentId?: string
  }) => ID | null
  editComment: (id: ID, body: string) => void
  /** Move a comment's anchor — used by the editor as the writer edits around it. */
  remapComment: (id: ID, anchor: { from: number; to: number; quote: string }) => void
  toggleCommentResolved: (id: ID) => void
  deleteComment: (id: ID) => void
  setFocusedComment: (id: ID | null) => void

  // — binder filter & saved collections —
  /** The query the binder is currently filtered by. Empty query = no filter. */
  binderQuery: NodeQuery
  /** The saved collection the filter came from, when it came from one. */
  activeCollectionId: ID | null
  setBinderQuery: (q: NodeQuery) => void
  clearBinderQuery: () => void
  /** Apply a saved collection's query to the binder. */
  applyCollection: (id: ID) => void
  saveCollection: (name: string, query: NodeQuery) => ID | null
  renameCollection: (id: ID, name: string) => void
  deleteCollection: (id: ID) => void

  // — project dictionary —
  addDictionaryWord: (word: string) => void
  removeDictionaryWord: (word: string) => void

  // — propagation debt —
  raiseDebt: (item: DebtItem) => void
  resolveDebtAffected: (debtId: ID, docId: ID) => void
  dismissDebt: (debtId: ID) => void

  // — slop scorer —
  setSlopSpans: (spans: import('../components/editor/extensions').SlopSpan[]) => void
  setSlopRunning: (on: boolean) => void

  // — session tracking —
  recordWordDelta: (delta: number) => void

  // — project settings —
  setProjectWordTarget: (target: number | undefined) => void
  /** Merge a patch into project settings (persisted). For book metadata etc. */
  updateProjectSettings: (patch: Partial<ProjectSettings>) => void
  setVoiceFingerprint: (text: string) => void
  setAiInstructions: (text: string) => void
  setAutopilotRun: (run: import('@shared/types').AutopilotRunState | null) => void

  // — judge scores (keyed by nodeId; persisted to aux/quality.json) —
  judgeResults: Map<ID, JudgeResult>
  setJudgeResult: (nodeId: ID, result: JudgeResult) => void
  // — slop results (keyed by nodeId; persisted to aux/slop.json) —
  slopResults: Map<ID, SlopResult>
  setSlopResult: (nodeId: ID, result: SlopResult) => void
  // — voice-drift results (keyed by nodeId; persisted to aux/voice.json) —
  voiceResults: Map<ID, VoiceResult>
  setVoiceResult: (nodeId: ID, result: VoiceResult) => void
  // — cross-draft craft trend (one point per Evaluate-all pass; aux/quality-history.json) —
  qualityHistory: QualityPoint[]
  pushQualityPoint: (point: QualityPoint) => void
  /** Load persisted judge + slop + voice scores + trend for the current project (call on mount). */
  hydrateJudgeResults: () => Promise<void>

  // — autopilot runner —
  autopilotQueue: string[]
  autopilotRunning: boolean
  autopilotCurrent: string | null
  autopilotPreset: string[]        // node IDs to pre-select in the runner (e.g. scaffolded chapters)
  setAutopilotQueue: (ids: string[]) => void
  setAutopilotRunning: (on: boolean) => void
  setAutopilotCurrent: (id: string | null) => void
  setAutopilotPreset: (ids: string[]) => void
}

// ── tree utilities (renderer-local, no disk access) ──────────────────────────

export function flattenVisible(project: Project): Array<{ id: ID; depth: number }> {
  const out: Array<{ id: ID; depth: number }> = []
  const walk = (ids: ID[], depth: number) => {
    for (const id of ids) {
      const n = project.nodes[id]
      if (!n) continue
      out.push({ id, depth })
      if (n.type === 'folder' && n.expanded) walk(n.childIds, depth + 1)
    }
  }
  walk(project.rootIds, 0)
  return out
}

export function subtreeWordCount(project: Project, id: ID): number {
  const node = project.nodes[id]
  if (!node) return 0
  let total = 0
  if (node.type !== 'folder') total += wordCount(project.docs[id]?.content ?? '')
  for (const cid of node.childIds) total += subtreeWordCount(project, cid)
  return total
}

export function descendants(project: Project, id: ID): ID[] {
  const acc: ID[] = []
  const walk = (i: ID) => {
    for (const c of project.nodes[i]?.childIds ?? []) { acc.push(c); walk(c) }
  }
  walk(id)
  return acc
}

export function isDescendant(project: Project, ancestorId: ID, targetId: ID): boolean {
  return descendants(project, ancestorId).includes(targetId)
}

// ── comment persistence ──────────────────────────────────────────────────────
//
// Two write paths on purpose. Creating, editing, resolving, or deleting a
// comment is the writer acting, and lands immediately. Re-anchoring is the
// comment following text the writer is typing around — that fires on nearly
// every keystroke, so it's coalesced. Worst case on a hard crash mid-debounce
// is a stale offset, which `reanchor` recovers from on the next open; the
// comment itself is never at risk.

const COMMENT_SAVE_DEBOUNCE_MS = 400
let commentSaveTimer: ReturnType<typeof setTimeout> | null = null
let pendingCommentSave: { projectId: ID; comments: Comment[] } | null = null

/** Write whatever comment state is queued, now. */
export function flushCommentSave(): void {
  if (commentSaveTimer) { clearTimeout(commentSaveTimer); commentSaveTimer = null }
  const p = pendingCommentSave
  pendingCommentSave = null
  if (!p) return
  window.api.comments.save(p.projectId, p.comments).catch((e: Error) => {
    useShellStore.getState().setToast('Comments could not be saved: ' + e.message)
  })
}

/** Persist now (writer-initiated change). */
function persistComments(projectId: ID, comments: Comment[]): void {
  pendingCommentSave = { projectId, comments }
  flushCommentSave()
}

/** Persist soon, collapsing a burst into one write (anchor drift). */
function persistCommentsSoon(projectId: ID, comments: Comment[]): void {
  pendingCommentSave = { projectId, comments }
  if (commentSaveTimer) clearTimeout(commentSaveTimer)
  commentSaveTimer = setTimeout(flushCommentSave, COMMENT_SAVE_DEBOUNCE_MS)
}

/**
 * Collections ride in project settings rather than a sidecar of their own:
 * they're a handful of small JSON objects, edited deliberately and rarely, so
 * the extra file (and the extra merge surface) would buy nothing.
 */
function persistCollections(projectId: ID, collections: Collection[]): void {
  window.api.settings.save(projectId, { collections }).catch((e: Error) => {
    useShellStore.getState().setToast('Collections could not be saved: ' + e.message)
  })
}

// ── store ────────────────────────────────────────────────────────────────────

const EMPTY_INDEX: MentionIndex = { aliasToDocIds: new Map(), docToAliases: new Map() }

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  selectedId: null,
  openTabs: [],
  openViewTabs: [],
  activeViewTab: null,
  splitId: null,
  splitOpen: false,
  view: 'editor',
  saveStatus: 'saved',
  lastSaved: null,
  renamingId: null,
  focusMode: false,
  compositionMode: false,
  mentionIndex: EMPTY_INDEX,
  proposals: [],
  activeProposalId: null,
  codex: [],
  debt: [],
  comments: [],
  focusedCommentId: null,
  collections: [],
  dictionary: [],
  binderQuery: {},
  activeCollectionId: null,
  slopSpans: [],
  slopRunning: false,
  nodeHistory: [],
  nodeFuture: [],
  judgeResults: new Map(),
  slopResults: new Map(),
  voiceResults: new Map(),
  qualityHistory: [],
  sessionWordsAdded: 0,
  autopilotQueue: [],
  autopilotRunning: false,
  autopilotCurrent: null,
  autopilotPreset: [],
  cursor: null,
  pendingReveal: null,

  loadProject: (project) => {
    useShellStore.getState().setRailPanel('inspector')
    set({
      project,
      selectedId: null,
      openTabs: [],
      openViewTabs: [],
      activeViewTab: null,
      view: 'editor',
      saveStatus: 'saved',
      renamingId: null,
      mentionIndex: buildIndex(project.docs),
      codex: (project.settings.codex as CodexEntry[] | undefined) ?? [],
      debt: (project.settings.debt as DebtItem[] | undefined) ?? [],
      comments: (project.settings.comments as Comment[] | undefined) ?? [],
      focusedCommentId: null,
      collections: (project.settings.collections as Collection[] | undefined) ?? [],
      dictionary: (project.settings.dictionary as string[] | undefined) ?? [],
      binderQuery: {},
      activeCollectionId: null,
      proposals: [],
      activeProposalId: null,
      nodeHistory: [],
      nodeFuture: [],
      judgeResults: new Map(),
      slopResults: new Map(),
      voiceResults: new Map(),
      qualityHistory: [],
      sessionWordsAdded: 0,
      autopilotQueue: [],
      autopilotRunning: false,
      autopilotCurrent: null,
      autopilotPreset: [],
      focusMode: false,
      compositionMode: false,
      splitOpen: false,
      splitId: null,
      cursor: null,
      pendingReveal: null,
    })
  },
  unloadProject: () => {
    flushCommentSave()   // don't drop a debounced anchor update on close
    useShellStore.getState().setRailPanel('inspector')
    set({ project: null, selectedId: null, openTabs: [], openViewTabs: [], activeViewTab: null, mentionIndex: EMPTY_INDEX, codex: [], debt: [], comments: [], focusedCommentId: null, collections: [], dictionary: [], binderQuery: {}, activeCollectionId: null, proposals: [], activeProposalId: null, slopSpans: [], slopRunning: false, nodeHistory: [], nodeFuture: [], judgeResults: new Map(), slopResults: new Map(), voiceResults: new Map(), qualityHistory: [], sessionWordsAdded: 0, autopilotQueue: [], autopilotRunning: false, autopilotCurrent: null, autopilotPreset: [], focusMode: false, compositionMode: false, splitOpen: false, splitId: null, cursor: null, pendingReveal: null })
  },

  selectNode: (id) => set((s) => {
    // Selecting a document leaves any view tab (returns the main pane to the editor).
    if (!id || !s.project) return { selectedId: id, cursor: null, activeViewTab: null }
    const node = s.project.nodes[id]
    if (!node) return { selectedId: id, cursor: null, activeViewTab: null }
    // Auto-switch view based on node type
    const newView = node.type === 'folder'
      ? (s.view === 'editor' ? 'corkboard' : s.view)
      : 'editor'
    // Opening a document surfaces it as a tab (folders don't get tabs).
    const openTabs = node.type !== 'folder' && !s.openTabs.includes(id)
      ? [...s.openTabs, id]
      : s.openTabs
    return { selectedId: id, view: newView, cursor: null, openTabs, activeViewTab: null }
  }),

  closeTab: (id) => set((s) => {
    const idx = s.openTabs.indexOf(id)
    if (idx === -1) return {}
    const openTabs = s.openTabs.filter((t) => t !== id)
    // If the active tab closed, activate its right neighbour (else left, else none).
    if (s.selectedId === id) {
      const next = openTabs[idx] ?? openTabs[idx - 1] ?? null
      return { openTabs, selectedId: next, cursor: null }
    }
    return { openTabs }
  }),

  openViewTab: (v) => set((s) => ({
    openViewTabs: s.openViewTabs.includes(v) ? s.openViewTabs : [...s.openViewTabs, v],
    activeViewTab: v,
  })),
  selectViewTab: (v) => set({ activeViewTab: v }),
  closeViewTab: (v) => set((s) => {
    const idx = s.openViewTabs.indexOf(v)
    if (idx === -1) return {}
    const openViewTabs = s.openViewTabs.filter((t) => t !== v)
    // If the active view tab closed, fall back to a neighbour; if none remain,
    // activeViewTab goes null and the main pane returns to the document editor.
    if (s.activeViewTab === v) {
      const next = openViewTabs[idx] ?? openViewTabs[idx - 1] ?? null
      return { openViewTabs, activeViewTab: next }
    }
    return { openViewTabs }
  }),

  setSplitId: (splitId) => set({ splitId }),
  toggleSplit: () => set((s) => s.splitOpen ? { splitOpen: false, splitId: null } : { splitOpen: true }),
  // Switching the main view control (Editor/Corkboard/…) leaves any view tab.
  setView: (view) => set({ view, activeViewTab: null }),
  setRenamingId: (renamingId) => set({ renamingId }),
  setFocusMode: (focusMode) => set({ focusMode }),
  setCompositionMode: (compositionMode) => set({ compositionMode }),
  setCursor: (cursor) => set({ cursor }),
  setPendingReveal: (pendingReveal) => set({ pendingReveal }),

  updateContent: (docId, content) => set((s) => {
    if (!s.project) return {}
    const prevContent = s.project.docs[docId]?.content ?? ''
    const prevWords = wordCount(prevContent)
    const newWords = wordCount(content)
    const delta = newWords - prevWords
    if (delta > 0) statsService.recordDelta(delta)
    const sessionWordsAdded = Math.max(0, s.sessionWordsAdded + delta)
    return {
      saveStatus: 'saving',
      sessionWordsAdded,
      project: {
        ...s.project,
        docs: {
          ...s.project.docs,
          [docId]: { ...(s.project.docs[docId] ?? { snapshots: [] }), content },
        },
      },
      mentionIndex: updateIndex(s.mentionIndex, docId, content),
    }
  }),

  setSaveStatus: (saveStatus, lastSaved) => set({ saveStatus, ...(lastSaved ? { lastSaved } : {}) }),

  applyMutation: ({ rootIds, nodes, docs }) => set((s) => {
    if (!s.project) return {}
    const snapshot = { rootIds: s.project.rootIds, nodes: s.project.nodes }
    const history = [...s.nodeHistory, snapshot].slice(-50)
    // A node deleted outright takes its comments with it. This is the single
    // place every structural mutation lands, so purging here covers all the
    // delete call sites at once. Trashing keeps the node in the tree, so
    // trashed documents deliberately keep their notes.
    const comments = s.comments.filter((c) => nodes[c.docId])
    if (comments.length !== s.comments.length) persistComments(s.project.id, comments)
    // A fresh mutation invalidates the redo stack.
    return { project: { ...s.project, rootIds, nodes, docs }, nodeHistory: history, nodeFuture: [], comments }
  }),

  // Undo/redo move whole-tree snapshots between the past/future stacks and
  // persist the restored tree through the `setTree` op so the in-memory store,
  // the project service, and the on-disk manifest stay in sync. Document
  // content is untouched (only structure changes).
  undoMutation: () => {
    const s = get()
    if (!s.project || s.nodeHistory.length === 0) return false
    const prev = s.nodeHistory[s.nodeHistory.length - 1]
    const current = { rootIds: s.project.rootIds, nodes: s.project.nodes }
    set({
      project: { ...s.project, rootIds: prev.rootIds, nodes: prev.nodes },
      nodeHistory: s.nodeHistory.slice(0, -1),
      nodeFuture: [...s.nodeFuture, current],
    })
    window.api.node.mutate(s.project.id, { type: 'setTree', rootIds: prev.rootIds, nodes: prev.nodes }).catch((e: Error) => {
      useShellStore.getState().setToast('Undo could not be saved: ' + e.message)
      // Revert the optimistic store change so the UI matches what's actually
      // on disk. The project service's in-memory tree was already mutated by
      // applyOp before the failed write, but `setTree` always replaces the
      // whole tree wholesale, so the next successful undo/redo self-heals it.
      set((s2) => s2.project ? {
        project: { ...s2.project, rootIds: current.rootIds, nodes: current.nodes },
        nodeHistory: [...s2.nodeHistory, prev],
        nodeFuture: s2.nodeFuture.slice(0, -1),
      } : {})
    })
    return true
  },
  redoMutation: () => {
    const s = get()
    if (!s.project || s.nodeFuture.length === 0) return false
    const next = s.nodeFuture[s.nodeFuture.length - 1]
    const current = { rootIds: s.project.rootIds, nodes: s.project.nodes }
    set({
      project: { ...s.project, rootIds: next.rootIds, nodes: next.nodes },
      nodeFuture: s.nodeFuture.slice(0, -1),
      nodeHistory: [...s.nodeHistory, current].slice(-50),
    })
    window.api.node.mutate(s.project.id, { type: 'setTree', rootIds: next.rootIds, nodes: next.nodes }).catch((e: Error) => {
      useShellStore.getState().setToast('Redo could not be saved: ' + e.message)
      // See undoMutation: revert the optimistic change; setTree self-heals
      // the project service's cache on the next successful call.
      set((s2) => s2.project ? {
        project: { ...s2.project, rootIds: current.rootIds, nodes: current.nodes },
        nodeFuture: [...s2.nodeFuture, next],
        nodeHistory: s2.nodeHistory.slice(0, -1),
      } : {})
    })
    return true
  },

  updateMeta: (nodeId, patch) => set((s) => {
    if (!s.project) return {}
    const node = s.project.nodes[nodeId]
    if (!node) return {}
    return {
      project: {
        ...s.project,
        nodes: { ...s.project.nodes, [nodeId]: { ...node, meta: { ...node.meta, ...patch } } },
      },
    }
  }),

  setProjectTitle: (title) => set((s) => {
    if (!s.project) return {}
    return { project: { ...s.project, title } }
  }),

  addSnapshot: (nodeId, snap) => set((s) => {
    if (!s.project) return {}
    const body = s.project.docs[nodeId] ?? { content: '', snapshots: [] }
    return {
      project: {
        ...s.project,
        docs: { ...s.project.docs, [nodeId]: { ...body, snapshots: [snap, ...body.snapshots] } },
      },
    }
  }),

  removeSnapshot: (nodeId, snapId) => set((s) => {
    if (!s.project) return {}
    const body = s.project.docs[nodeId]
    if (!body) return {}
    return {
      project: {
        ...s.project,
        docs: { ...s.project.docs, [nodeId]: { ...body, snapshots: body.snapshots.filter((x) => x.id !== snapId) } },
      },
    }
  }),

  restoreContent: (nodeId, content) => {
    get().updateContent(nodeId, content)
  },

  queueProposal: (p) => set((s) => ({ proposals: [...s.proposals, p], activeProposalId: s.activeProposalId ?? p.id })),
  resolveProposal: (id, status) => set((s) => {
    const proposals = s.proposals.map((p) => p.id === id ? { ...p, status } : p)
    const next = proposals.find((p) => p.status === 'pending' && p.id !== id)
    return { proposals, activeProposalId: next?.id ?? null }
  }),
  setActiveProposal: (id) => set({ activeProposalId: id }),

  upsertCodexEntry: (entry) => set((s) => {
    const existing = s.codex.findIndex((e) => e.id === entry.id)
    const codex = existing >= 0
      ? s.codex.map((e) => e.id === entry.id ? entry : e)
      : [...s.codex, entry]
    if (s.project) window.api.codex.save(s.project.id, codex).catch((e: Error) => {
      useShellStore.getState().setToast('Codex could not be saved: ' + e.message)
    })
    return { codex }
  }),
  deleteCodexEntry: (id) => set((s) => {
    const codex = s.codex.filter((e) => e.id !== id)
    if (s.project) window.api.codex.save(s.project.id, codex).catch((e: Error) => {
      useShellStore.getState().setToast('Codex could not be saved: ' + e.message)
    })
    return { codex }
  }),

  addComment: ({ docId, from, to, body, author = 'You', origin = 'author', agentId }) => {
    const s = get()
    if (!s.project) return null
    const content = s.project.docs[docId]?.content ?? ''
    // Anchor to the trimmed span: a comment that starts on leading whitespace
    // drifts the moment the paragraph reflows.
    const span = trimAnchor(content, from, to)
    const now = new Date().toISOString()
    const comment: Comment = {
      id: uid('cm'),
      docId,
      anchor: { from: span.from, to: span.to, quote: content.slice(span.from, span.to) },
      body,
      author,
      origin,
      ...(agentId ? { agentId } : {}),
      createdAt: now,
      modifiedAt: now,
      resolved: false,
    }
    set({ comments: [...s.comments, comment] })
    persistComments(s.project.id, [...s.comments, comment])
    return comment.id
  },

  editComment: (id, body) => set((s) => {
    const comments = s.comments.map((c) =>
      c.id === id ? { ...c, body, modifiedAt: new Date().toISOString() } : c)
    if (s.project) persistComments(s.project.id, comments)
    return { comments }
  }),

  // Position-only update: the writer edited around (or inside) the span and the
  // editor mapped the anchor forward. Deliberately does NOT touch modifiedAt —
  // moving with the text isn't the writer revising the note.
  remapComment: (id, anchor) => set((s) => {
    const before = s.comments.find((c) => c.id === id)
    if (!before) return {}
    const { from, to, quote } = before.anchor
    if (from === anchor.from && to === anchor.to && quote === anchor.quote) return {}
    const comments = s.comments.map((c) => c.id === id ? { ...c, anchor } : c)
    if (s.project) persistCommentsSoon(s.project.id, comments)
    return { comments }
  }),

  toggleCommentResolved: (id) => set((s) => {
    const comments = s.comments.map((c) =>
      c.id === id ? { ...c, resolved: !c.resolved, modifiedAt: new Date().toISOString() } : c)
    if (s.project) persistComments(s.project.id, comments)
    return { comments }
  }),

  deleteComment: (id) => set((s) => {
    const comments = s.comments.filter((c) => c.id !== id)
    if (s.project) persistComments(s.project.id, comments)
    return { comments, focusedCommentId: s.focusedCommentId === id ? null : s.focusedCommentId }
  }),

  setFocusedComment: (focusedCommentId) => set({ focusedCommentId }),

  // Editing the filter by hand detaches it from whichever collection it came
  // from — otherwise the binder would claim to be showing a saved collection
  // while actually showing something else.
  setBinderQuery: (binderQuery) => set({ binderQuery, activeCollectionId: null }),
  clearBinderQuery: () => set({ binderQuery: {}, activeCollectionId: null }),

  applyCollection: (id) => set((s) => {
    const c = s.collections.find((x) => x.id === id)
    if (!c) return {}
    return { binderQuery: c.query, activeCollectionId: id }
  }),

  saveCollection: (name, query) => {
    const s = get()
    if (!s.project) return null
    const now = new Date().toISOString()
    const collection: Collection = { id: uid('col'), name: name.trim() || 'Untitled', query, createdAt: now, modifiedAt: now }
    const collections = [...s.collections, collection]
    set({ collections, activeCollectionId: collection.id })
    persistCollections(s.project.id, collections)
    return collection.id
  },

  renameCollection: (id, name) => set((s) => {
    const collections = s.collections.map((c) =>
      c.id === id ? { ...c, name: name.trim() || c.name, modifiedAt: new Date().toISOString() } : c)
    if (s.project) persistCollections(s.project.id, collections)
    return { collections }
  }),

  deleteCollection: (id) => set((s) => {
    const collections = s.collections.filter((c) => c.id !== id)
    if (s.project) persistCollections(s.project.id, collections)
    // Deleting the collection that's driving the binder drops the filter with
    // it, rather than leaving an anonymous filter the writer can't identify.
    return s.activeCollectionId === id
      ? { collections, binderQuery: {}, activeCollectionId: null }
      : { collections }
  }),

  // Adding a word is how a false positive gets silenced forever, so it has to
  // be cheap and permanent. The native spellchecker is told too, where the
  // platform allows it (Electron); in the browser there is no such hook, and
  // the word still counts for Konbini's own name check.
  addDictionaryWord: (word) => set((s) => {
    const w = word.trim()
    if (!w || !s.project) return {}
    if (s.dictionary.some((x) => x.toLowerCase() === w.toLowerCase())) return {}
    const dictionary = [...s.dictionary, w].sort((a, b) => a.localeCompare(b))
    window.api.settings.save(s.project.id, { dictionary }).catch(console.error)
    window.api.spell?.addWord(w)
    return { dictionary }
  }),

  removeDictionaryWord: (word) => set((s) => {
    if (!s.project) return {}
    const dictionary = s.dictionary.filter((x) => x.toLowerCase() !== word.toLowerCase())
    if (dictionary.length === s.dictionary.length) return {}
    window.api.settings.save(s.project.id, { dictionary }).catch(console.error)
    window.api.spell?.removeWord(word)
    return { dictionary }
  }),

  raiseDebt: (item) => set((s) => {
    // Supersede any existing unresolved item from the same source + title
    // (re-editing the same fact updates the open item instead of stacking).
    const debt = [item, ...s.debt.filter((d) => !(d.source === item.source && d.title === item.title))]
    if (s.project) window.api.debt.save(s.project.id, debt).catch(console.error)
    return { debt }
  }),
  resolveDebtAffected: (debtId, docId) => set((s) => {
    const debt = s.debt.map((d) =>
      d.id === debtId
        ? { ...d, affected: d.affected.map((a) => a.docId === docId ? { ...a, resolved: true } : a) }
        : d
    )
    if (s.project) window.api.debt.save(s.project.id, debt).catch(console.error)
    return { debt }
  }),
  dismissDebt: (debtId) => set((s) => {
    const debt = s.debt.filter((d) => d.id !== debtId)
    if (s.project) window.api.debt.save(s.project.id, debt).catch(console.error)
    return { debt }
  }),

  setSlopSpans: (slopSpans) => set({ slopSpans, slopRunning: false }),
  setSlopRunning: (on) => set({ slopRunning: on }),

  setJudgeResult: (nodeId, result) => set((s) => {
    const next = new Map(s.judgeResults)
    next.set(nodeId, result)
    const p = s.project
    if (p) window.api.aux.write(p.id, 'quality.json', JSON.stringify(Object.fromEntries(next))).catch(console.error)
    return { judgeResults: next }
  }),

  setSlopResult: (nodeId, result) => set((s) => {
    const next = new Map(s.slopResults)
    next.set(nodeId, result)
    const p = s.project
    if (p) window.api.aux.write(p.id, 'slop.json', JSON.stringify(Object.fromEntries(next))).catch(console.error)
    return { slopResults: next }
  }),

  setVoiceResult: (nodeId, result) => set((s) => {
    const next = new Map(s.voiceResults)
    next.set(nodeId, result)
    const p = s.project
    if (p) window.api.aux.write(p.id, 'voice.json', JSON.stringify(Object.fromEntries(next))).catch(console.error)
    return { voiceResults: next }
  }),

  pushQualityPoint: (point) => set((s) => {
    const next = [...s.qualityHistory, point].slice(-50)  // keep the last 50 passes
    const p = s.project
    if (p) window.api.aux.write(p.id, 'quality-history.json', JSON.stringify(next)).catch(console.error)
    return { qualityHistory: next }
  }),

  hydrateJudgeResults: async () => {
    const p = get().project
    if (!p) return
    const [jraw, sraw, vraw, hraw] = await Promise.all([
      window.api.aux.read(p.id, 'quality.json').catch(() => null),
      window.api.aux.read(p.id, 'slop.json').catch(() => null),
      window.api.aux.read(p.id, 'voice.json').catch(() => null),
      window.api.aux.read(p.id, 'quality-history.json').catch(() => null),
    ])
    const patch: Partial<ProjectState> = {}
    if (jraw) { try { patch.judgeResults = new Map(Object.entries(JSON.parse(jraw) as Record<string, JudgeResult>)) } catch { /* corrupt */ } }
    if (sraw) { try { patch.slopResults = new Map(Object.entries(JSON.parse(sraw) as Record<string, SlopResult>)) } catch { /* corrupt */ } }
    if (vraw) { try { patch.voiceResults = new Map(Object.entries(JSON.parse(vraw) as Record<string, VoiceResult>)) } catch { /* corrupt */ } }
    if (hraw) { try { const h = JSON.parse(hraw); if (Array.isArray(h)) patch.qualityHistory = h as QualityPoint[] } catch { /* corrupt */ } }
    if (Object.keys(patch).length) set(patch)
  },

  setAutopilotQueue: (autopilotQueue) => set({ autopilotQueue }),
  setAutopilotRunning: (autopilotRunning) => set({ autopilotRunning }),
  setAutopilotCurrent: (autopilotCurrent) => set({ autopilotCurrent }),
  setAutopilotPreset: (autopilotPreset) => set({ autopilotPreset }),

  recordWordDelta: (delta) => set((s) => ({ sessionWordsAdded: Math.max(0, s.sessionWordsAdded + delta) })),

  setProjectWordTarget: (target) => {
    const p = get().project
    if (!p) return
    const updated = { ...p, settings: { ...p.settings, wordTarget: target } }
    set({ project: updated })
    window.api.settings.save(p.id, { wordTarget: target })
  },

  updateProjectSettings: (patch) => {
    const p = get().project
    if (!p) return
    set({ project: { ...p, settings: { ...p.settings, ...patch } } })
    window.api.settings.save(p.id, patch).catch(console.error)
  },

  setVoiceFingerprint: (text) => {
    const p = get().project
    if (!p) return
    const updated = { ...p, settings: { ...p.settings, voiceFingerprint: text } }
    set({ project: updated })
    window.api.settings.save(p.id, { voiceFingerprint: text }).catch(console.error)
  },

  setAiInstructions: (text) => {
    const p = get().project
    if (!p) return
    const updated = { ...p, settings: { ...p.settings, aiInstructions: text } }
    set({ project: updated })
    window.api.settings.save(p.id, { aiInstructions: text }).catch(console.error)
  },

  setAutopilotRun: (run) => {
    const p = get().project
    if (!p) return
    const updated = { ...p, settings: { ...p.settings, autopilotRun: run } }
    set({ project: updated })
    window.api.settings.save(p.id, { autopilotRun: run }).catch(console.error)
  },
}))
