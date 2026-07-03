import { create } from 'zustand'
import { useShellStore } from './shellStore'
import type { Project, KNode, DocBody, DocMeta, NodeType, ViewMode, SaveStatus, Snapshot, ID, Proposal, CodexEntry, DebtItem } from '@shared/types'
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
  debt: DebtItem[]
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
  setVoiceFingerprint: (text: string) => void
  setAutopilotRun: (run: import('@shared/types').AutopilotRunState | null) => void

  // — judge scores (keyed by nodeId) —
  judgeResults: Map<ID, { scores: Array<{ dimension: string; score: number; note: string }>; verdict: string }>
  setJudgeResult: (nodeId: ID, result: { scores: Array<{ dimension: string; score: number; note: string }>; verdict: string }) => void

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
  debt: [],
  slopSpans: [],
  slopRunning: false,
  nodeHistory: [],
  nodeFuture: [],
  judgeResults: new Map(),
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
      view: 'editor',
      saveStatus: 'saved',
      renamingId: null,
      mentionIndex: buildIndex(project.docs),
      codex: (project.settings.codex as CodexEntry[] | undefined) ?? [],
      debt: (project.settings.debt as DebtItem[] | undefined) ?? [],
      proposals: [],
      activeProposalId: null,
      nodeHistory: [],
      nodeFuture: [],
      judgeResults: new Map(),
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
    useShellStore.getState().setRailPanel('inspector')
    set({ project: null, selectedId: null, mentionIndex: EMPTY_INDEX, codex: [], debt: [], proposals: [], activeProposalId: null, slopSpans: [], slopRunning: false, nodeHistory: [], nodeFuture: [], judgeResults: new Map(), sessionWordsAdded: 0, autopilotQueue: [], autopilotRunning: false, autopilotCurrent: null, autopilotPreset: [], focusMode: false, compositionMode: false, splitOpen: false, splitId: null, cursor: null, pendingReveal: null })
  },

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
    // A fresh mutation invalidates the redo stack.
    return { project: { ...s.project, rootIds, nodes, docs }, nodeHistory: history, nodeFuture: [] }
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

  raiseDebt: (item) => set((s) => {
    // Supersede any existing unresolved item from the same source + title
    // (re-editing the same fact updates the open item instead of stacking).
    const debt = [item, ...s.debt.filter((d) => !(d.source === item.source && d.title === item.title))]
    if (s.project) window.api.settings.save(s.project.id, { debt }).catch(console.error)
    return { debt }
  }),
  resolveDebtAffected: (debtId, docId) => set((s) => {
    const debt = s.debt.map((d) =>
      d.id === debtId
        ? { ...d, affected: d.affected.map((a) => a.docId === docId ? { ...a, resolved: true } : a) }
        : d
    )
    if (s.project) window.api.settings.save(s.project.id, { debt }).catch(console.error)
    return { debt }
  }),
  dismissDebt: (debtId) => set((s) => {
    const debt = s.debt.filter((d) => d.id !== debtId)
    if (s.project) window.api.settings.save(s.project.id, { debt }).catch(console.error)
    return { debt }
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
  setAutopilotPreset: (autopilotPreset) => set({ autopilotPreset }),

  recordWordDelta: (delta) => set((s) => ({ sessionWordsAdded: Math.max(0, s.sessionWordsAdded + delta) })),

  setProjectWordTarget: (target) => {
    const p = get().project
    if (!p) return
    const updated = { ...p, settings: { ...p.settings, wordTarget: target } }
    set({ project: updated })
    window.api.settings.save(p.id, { wordTarget: target })
  },

  setVoiceFingerprint: (text) => {
    const p = get().project
    if (!p) return
    const updated = { ...p, settings: { ...p.settings, voiceFingerprint: text } }
    set({ project: updated })
    window.api.settings.save(p.id, { voiceFingerprint: text }).catch(console.error)
  },

  setAutopilotRun: (run) => {
    const p = get().project
    if (!p) return
    const updated = { ...p, settings: { ...p.settings, autopilotRun: run } }
    set({ project: updated })
    window.api.settings.save(p.id, { autopilotRun: run }).catch(console.error)
  },
}))
