import { create } from 'zustand'
import type { Project, KNode, DocBody, DocMeta, NodeType, ViewMode, SaveStatus, Snapshot, ID, Proposal, CodexEntry } from '@shared/types'
import { uid, wordCount } from '@shared/utils'
import { type MentionIndex, buildIndex, updateIndex } from '../lib/MentionIndex'
import { statsService } from '../lib/StatsService'

interface ProjectState {
  project: Project | null
  selectedId: ID | null
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
  slopSpans: import('../components/editor/extensions').SlopSpan[]
  slopRunning: boolean
  nodeHistory: Array<{ rootIds: ID[]; nodes: Record<ID, KNode> }>
  sessionWordsAdded: number
  cursor: { line: number; col: number } | null
  // A range to reveal+select in the editor once its doc is active (search jump).
  pendingReveal: { docId: ID; from: number; len: number } | null

  // — project lifecycle —
  loadProject: (p: Project) => void
  unloadProject: () => void

  // — selection & view —
  selectNode: (id: ID | null) => void
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

  // — slop scorer —
  setSlopSpans: (spans: import('../components/editor/extensions').SlopSpan[]) => void
  setSlopRunning: (on: boolean) => void

  // — session tracking —
  recordWordDelta: (delta: number) => void

  // — project settings —
  setProjectWordTarget: (target: number | undefined) => void

  // — judge scores (keyed by nodeId) —
  judgeResults: Map<ID, { scores: Array<{ dimension: string; score: number; note: string }>; verdict: string }>
  setJudgeResult: (nodeId: ID, result: { scores: Array<{ dimension: string; score: number; note: string }>; verdict: string }) => void

  // — autopilot runner —
  autopilotQueue: string[]
  autopilotRunning: boolean
  autopilotCurrent: string | null
  setAutopilotQueue: (ids: string[]) => void
  setAutopilotRunning: (on: boolean) => void
  setAutopilotCurrent: (id: string | null) => void
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

// ── store ────────────────────────────────────────────────────────────────────

const EMPTY_INDEX: MentionIndex = { aliasToDocIds: new Map(), docToAliases: new Map() }

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  selectedId: null,
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
  slopSpans: [],
  slopRunning: false,
  nodeHistory: [],
  judgeResults: new Map(),
  sessionWordsAdded: 0,
  autopilotQueue: [],
  autopilotRunning: false,
  autopilotCurrent: null,
  cursor: null,
  pendingReveal: null,

  loadProject: (project) => set({
    project,
    selectedId: null,
    view: 'editor',
    saveStatus: 'saved',
    renamingId: null,
    mentionIndex: buildIndex(project.docs),
    codex: (project.settings.codex as CodexEntry[] | undefined) ?? [],
    proposals: [],
    activeProposalId: null,
    nodeHistory: [],
    judgeResults: new Map(),
    sessionWordsAdded: 0,
    autopilotQueue: [],
    autopilotRunning: false,
    autopilotCurrent: null,
    focusMode: false,
    compositionMode: false,
    splitOpen: false,
    splitId: null,
    cursor: null,
    pendingReveal: null,
  }),
  unloadProject: () => set({ project: null, selectedId: null, mentionIndex: EMPTY_INDEX, codex: [], proposals: [], activeProposalId: null, slopSpans: [], slopRunning: false, nodeHistory: [], judgeResults: new Map(), sessionWordsAdded: 0, autopilotQueue: [], autopilotRunning: false, autopilotCurrent: null, focusMode: false, compositionMode: false, splitOpen: false, splitId: null, cursor: null, pendingReveal: null }),

  selectNode: (id) => set((s) => {
    if (!id || !s.project) return { selectedId: id, cursor: null }
    const node = s.project.nodes[id]
    if (!node) return { selectedId: id, cursor: null }
    // Auto-switch view based on node type
    const newView = node.type === 'folder'
      ? (s.view === 'editor' ? 'corkboard' : s.view)
      : 'editor'
    return { selectedId: id, view: newView, cursor: null }
  }),

  setSplitId: (splitId) => set({ splitId }),
  toggleSplit: () => set((s) => s.splitOpen ? { splitOpen: false, splitId: null } : { splitOpen: true }),
  setView: (view) => set({ view }),
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
    return { project: { ...s.project, rootIds, nodes, docs }, nodeHistory: history }
  }),

  undoMutation: () => {
    const s = get()
    if (!s.project || s.nodeHistory.length === 0) return false
    const prev = s.nodeHistory[s.nodeHistory.length - 1]
    set({
      project: { ...s.project, rootIds: prev.rootIds, nodes: prev.nodes },
      nodeHistory: s.nodeHistory.slice(0, -1),
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
    if (s.project) window.api.codex.save(s.project.id, codex).catch(console.error)
    return { codex }
  }),
  deleteCodexEntry: (id) => set((s) => {
    const codex = s.codex.filter((e) => e.id !== id)
    if (s.project) window.api.codex.save(s.project.id, codex).catch(console.error)
    return { codex }
  }),

  setSlopSpans: (slopSpans) => set({ slopSpans, slopRunning: false }),
  setSlopRunning: (on) => set({ slopRunning: on }),

  setJudgeResult: (nodeId, result) => set((s) => {
    const next = new Map(s.judgeResults)
    next.set(nodeId, result)
    return { judgeResults: next }
  }),

  setAutopilotQueue: (autopilotQueue) => set({ autopilotQueue }),
  setAutopilotRunning: (autopilotRunning) => set({ autopilotRunning }),
  setAutopilotCurrent: (autopilotCurrent) => set({ autopilotCurrent }),

  recordWordDelta: (delta) => set((s) => ({ sessionWordsAdded: Math.max(0, s.sessionWordsAdded + delta) })),

  setProjectWordTarget: (target) => {
    const p = get().project
    if (!p) return
    const updated = { ...p, settings: { ...p.settings, wordTarget: target } }
    set({ project: updated })
    window.api.settings.save(p.id, { wordTarget: target })
  },
}))
