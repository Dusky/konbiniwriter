// AdventureView — beat-by-beat drafting of the manuscript.
//
// The passage pane is the real editor, bound to the real scene document. That
// is the load-bearing decision here: the author can fix a clumsy sentence the
// moment they see it, there is no second text surface to keep in sync, and
// autosave / undo / live preview / slop underlines / comments all keep working.
// Invariant 4 holds by construction rather than by care.
//
// Writes only ever append. Before every append the scene is snapshotted, so the
// worst case is one passage the author didn't want, undone with ⌘Z.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import { useShellStore } from '../../store/shellStore'
import Editor from '../editor/Editor'
import Icon from '../common/Icon'
import ModalShell from '../common/ModalShell'
import ChoiceDeck from './adventure/ChoiceDeck'
import NotesInbox from './adventure/NotesInbox'
import Transcript from './adventure/Transcript'
import AdventureSetup, { type SetupChoice } from './adventure/AdventureSetup'
import {
  answerAside, appendPassage, classifyIntent, generateOptions, lastPassageRange, newSession,
  recordTurn, settleTurn, spineLine, streamContinuation, streamOpening, streamPassage,
  streamRevision, takeNotes, updateSummary, SPINE_TITLE,
  type AdventureOption, type AdventureSession, type AdventureTurn, type Intent, type NoteCandidate,
} from '../../lib/adventure'
import { createProposal } from '../../lib/ProposalService'
import { uid, wordCount } from '@shared/utils'
import type { ID } from '@shared/types'

const SESSION_FILE = 'adventure.json'
const SAVE_DEBOUNCE_MS = 600

interface Props { onClose: () => void; embedded?: boolean }

/** What ⌘Z needs to put the manuscript back exactly as it was. */
interface UndoPoint {
  sceneId: ID
  snapshotId: ID
  /** A scene the beat created, deletable only while it is still empty. */
  createdSceneId: ID | null
  /** The spine as it read before this beat was added to it. */
  spine: { id: ID; content: string } | null
  options: AdventureOption[]
  summary: string
  /** The prose this beat added — the span a "make it shorter" would revise. */
  passage: string
}

export default function AdventureView({ onClose, embedded }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const mentionIndex = useProjectStore((s) => s.mentionIndex)
  const selectedId = useProjectStore((s) => s.selectedId)
  const updateContent = useProjectStore((s) => s.updateContent)
  const applyMutation = useProjectStore((s) => s.applyMutation)
  const addSnapshot = useProjectStore((s) => s.addSnapshot)
  const upsertCodexEntry = useProjectStore((s) => s.upsertCodexEntry)
  const queueProposal = useProjectStore((s) => s.queueProposal)
  const aiEnabled = useAIStore((s) => s.enabled)
  const setToast = useShellStore((s) => s.setToast)

  const [session, setSession] = useState<AdventureSession | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ghost, setGhost] = useState('')
  // Where the streaming text belongs: prose that will append shows under the
  // editor, where it is about to land. A revision replaces a span further up,
  // so previewing it at the bottom of the scene would be a lie about the edit.
  const [ghostMode, setGhostMode] = useState<'append' | 'revise'>('append')
  const [notes, setNotes] = useState<NoteCandidate[]>([])
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSummary, setShowSummary] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const sessionRef = useRef<AdventureSession | null>(null)
  const undoRef = useRef<UndoPoint | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const write = useCallback((next: AdventureSession | null) => {
    sessionRef.current = next
    setSession(next)
    const pid = useProjectStore.getState().project?.id
    if (!pid) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      window.api.aux.write(pid, SESSION_FILE, JSON.stringify(next ?? null)).catch(() => {
        setToast('Adventure session could not be saved', 'error')
      })
    }, SAVE_DEBOUNCE_MS)
  }, [setToast])

  // Restore the session on mount, so a tab you draft a book in never loses its
  // place. A session pointing at a document that no longer exists is dropped
  // rather than resumed into nothing.
  useEffect(() => {
    if (!project) return
    let cancelled = false
    setLoaded(false)
    window.api.aux.read(project.id, SESSION_FILE)
      .then((raw) => {
        if (cancelled) return
        const parsed = raw ? (JSON.parse(raw) as AdventureSession | null) : null
        // A session written before the conversation existed has neither field;
        // resuming one must not crash on an undefined transcript.
        const alive = parsed && project.nodes[parsed.activeSceneId]
          ? { ...parsed, turns: parsed.turns ?? [], deckOpen: parsed.deckOpen ?? true }
          : null
        sessionRef.current = alive
        setSession(alive)
      })
      .catch(() => { if (!cancelled) { sessionRef.current = null; setSession(null) } })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [project?.id])

  // Streaming components abort on unmount; a pending save is flushed rather
  // than dropped, since the debounce window is exactly when a tab gets closed.
  useEffect(() => () => {
    abortRef.current?.abort()
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      const pid = useProjectStore.getState().project?.id
      if (pid) window.api.aux.write(pid, SESSION_FILE, JSON.stringify(sessionRef.current ?? null)).catch(() => {})
    }
  }, [])

  const scene = session && project ? project.nodes[session.activeSceneId] : null
  const sceneContent = session && project ? (project.docs[session.activeSceneId]?.content ?? '') : ''
  const sceneWords = useMemo(() => wordCount(sceneContent), [sceneContent])

  // ── binder plumbing ────────────────────────────────────────────────────────

  const createNode = async (nodeType: 'document' | 'folder' | 'scene', title: string, parentId: ID | null): Promise<ID> => {
    const pid = useProjectStore.getState().project!.id
    const r = await window.api.node.mutate(pid, { type: 'create', parentId, nodeType, title })
    applyMutation(r)
    return Object.values(r.nodes).find((n) => n.ext['_newId'])!.id
  }

  /** Append to a document through the one mutation seam, and get it onto disk. */
  const appendTo = async (docId: ID, text: string) => {
    const pid = useProjectStore.getState().project!.id
    const existing = useProjectStore.getState().project?.docs[docId]?.content ?? ''
    const next = appendPassage(existing, text)
    updateContent(docId, next)
    // updateContent only touches the store; autosave runs for the *active*
    // editor, and the spine document is never the active editor.
    await window.api.doc.write(pid, docId, next)
  }

  const ensureSpine = async (s: AdventureSession): Promise<ID> => {
    if (s.spineId && useProjectStore.getState().project?.nodes[s.spineId]) return s.spineId
    return createNode('document', SPINE_TITLE, s.targetFolderId)
  }

  // ── the loop ───────────────────────────────────────────────────────────────

  /** Options + notes + summary, fired together once the prose has landed. */
  const settle = async (s: AdventureSession, passage: string, signal: AbortSignal): Promise<AdventureSession> => {
    const proj = useProjectStore.getState().project!
    setScanning(true)
    const [options, found, summary] = await Promise.all([
      generateOptions({ project: proj, index: useProjectStore.getState().mentionIndex, session: s, signal }).catch(() => [] as AdventureOption[]),
      takeNotes({ project: proj, passage, signal }).catch(() => [] as NoteCandidate[]),
      updateSummary({ summary: s.summary, passage, signal }).catch(() => s.summary),
    ])
    setScanning(false)
    setNotes(found)
    return { ...s, options, summary }
  }

  /** Put a line in the transcript before the model has answered it. */
  const openTurn = (s: AdventureSession, said: string, intent: Intent): { id: string; session: AdventureSession } => {
    const turn: AdventureTurn = {
      id: uid(), at: new Date().toISOString(), said, intent, got: '',
      pending: true, sceneId: s.activeSceneId,
    }
    return { id: turn.id, session: { ...s, turns: recordTurn(s.turns, turn) } }
  }

  /**
   * Write the next passage — either from a beat the author chose, or by carrying
   * on from where the text stops when they handed the pen back.
   *
   * Appends only. The snapshot before it is invariant 5's spirit on every turn:
   * the worst case is one passage nobody wanted, undone with ⌘Z.
   */
  const runBeat = async (raw: string, endScene: boolean, opts: { mode?: 'beat' | 'continue'; turnId?: string } = {}) => {
    const s = sessionRef.current
    const proj = useProjectStore.getState().project
    if (!s || !proj || busy) return
    const mode = opts.mode ?? 'beat'
    const opening = s.beats.length === 0 && !sceneContent.trim()
    // Opening a story from a premise needs no beat — the premise is the beat.
    const beat = raw.trim() || (opening ? s.premise.trim() : '')
    if (!beat && mode === 'beat') return
    setBusy(true); setError(null); setGhost(''); setGhostMode('append')
    const ctrl = new AbortController()
    abortRef.current = ctrl

    // A turn the caller already opened (free text, classified) is settled at the
    // end; anything else — a card, Continue — opens its own here.
    let started = s
    let turnId = opts.turnId
    if (!turnId) {
      const opened = openTurn(s, mode === 'continue' ? 'Carry on from here.' : beat, 'continue')
      turnId = opened.id
      started = opened.session
      write(started)
    }

    try {
      const snap = await window.api.snapshot.take(proj.id, s.activeSceneId, `Before "${beat.slice(0, 48) || 'continue'}"`, 'auto')
      addSnapshot(s.activeSceneId, snap)
      const undo: UndoPoint = { sceneId: s.activeSceneId, snapshotId: snap.id, createdSceneId: null, spine: null, options: s.options, summary: s.summary, passage: '' }

      const args = { project: proj, index: mentionIndex, session: s, signal: ctrl.signal, onChunk: setGhost }
      const passage = (
        mode === 'continue' ? await streamContinuation(args)
        : opening ? await streamOpening({ ...args, session: { ...s, premise: s.premise || beat } })
        : await streamPassage({ ...args, beat })
      ).trim()
      if (!passage) throw new Error('The model returned an empty passage.')

      await appendTo(s.activeSceneId, passage)
      setGhost('')
      undo.passage = passage

      let next: AdventureSession = {
        ...started,
        turns: settleTurn(started.turns, turnId, { got: passage }),
      }

      // Carrying on from the author's own sentence is not a decision, so it
      // contributes no line to the spine — an outline of "and then it continued"
      // is worse than one that only records the turns that chose something.
      if (mode === 'beat') {
        next = { ...next, beats: [...next.beats, { text: beat, sceneId: s.activeSceneId, at: new Date().toISOString() }] }
        const spineId = await ensureSpine(next)
        // Captured before the append so stepping back leaves no orphan line
        // behind — an outline that disagrees with the manuscript is worse than
        // no outline.
        undo.spine = { id: spineId, content: useProjectStore.getState().project?.docs[spineId]?.content ?? '' }
        const startsScene = next.beats.filter((b) => b.sceneId === s.activeSceneId).length === 1
        await appendTo(spineId, spineLine(next.beats[next.beats.length - 1]!, scene?.title ?? 'Scene', startsScene).trimEnd())
        next = { ...next, spineId }
      }

      if (endScene) {
        const created = await startNextScene(next)
        next = created.session
        undo.createdSceneId = created.sceneId
      }

      undoRef.current = undo
      write(await settle(next, passage, ctrl.signal))
    } catch (e) {
      const err = e as Error
      if (err.name !== 'AbortError') setError(err.message)
      setGhost('')
      const now = sessionRef.current
      if (now && turnId) write({ ...now, turns: settleTurn(now.turns, turnId, { got: err.name === 'AbortError' ? '(stopped)' : '' }) })
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  /**
   * A line the author typed, routed by what they meant.
   *
   * Cards from the deck bypass this — they are unambiguously beats. Free text is
   * classified first, because "that last bit is too flowery" is an instruction
   * about the passage just written, not a direction for the next one. Every
   * outcome is cheap to get wrong: a beat costs one step back, a revision
   * arrives as a changeset that can be rejected, a question writes nothing.
   */
  const say = async (text: string) => {
    const s = sessionRef.current
    const said = text.trim()
    if (!s || !said || busy) return
    const last = undoRef.current?.passage ?? ''

    setBusy(true); setError(null)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    let intent: Intent = 'continue'
    try {
      intent = await classifyIntent({ said, passage: last, signal: ctrl.signal })
    } catch {
      // A classifier that fails must not swallow the author's line: fall back to
      // the common case and let ⌘Z be the remedy.
      intent = 'continue'
    }
    setBusy(false)
    abortRef.current = null
    if (ctrl.signal.aborted) return

    const opened = openTurn(sessionRef.current ?? s, said, intent)
    write(opened.session)
    if (intent === 'revise') await revise(said, opened.id)
    else if (intent === 'ask') await ask(said, opened.id)
    else await runBeat(said, false, { turnId: opened.id })
  }

  /**
   * Rewrite the passage just written, to the author's note.
   *
   * The one thing in this tab that replaces prose rather than adding to it — so
   * it goes out as a `Proposal` and lands through the changeset review like
   * every other AI edit (invariant 2). Adventure never writes over a word.
   */
  const revise = async (instruction: string, turnId: string) => {
    const s = sessionRef.current
    const proj = useProjectStore.getState().project
    const passage = undoRef.current?.passage ?? ''
    if (!s || !proj) return
    const content = proj.docs[s.activeSceneId]?.content ?? ''
    const range = lastPassageRange(content, passage)
    if (!range) {
      // The passage has been edited by hand since it landed, so there is no span
      // to replace. Saying so beats revising something the author already fixed.
      write({ ...s, turns: settleTurn(s.turns, turnId, { got: 'That passage has been edited since — revise it in the editor, or write on and I\'ll follow.' }) })
      return
    }

    setBusy(true); setError(null); setGhost(''); setGhostMode('revise')
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const revised = (await streamRevision({
        project: proj, index: mentionIndex, session: s, instruction,
        passage: content.slice(range.from, range.to),
        signal: ctrl.signal, onChunk: setGhost,
      })).trim()
      setGhost('')
      if (!revised) throw new Error('The model returned an empty revision.')

      queueProposal(createProposal({
        docId: s.activeSceneId,
        docTitle: scene?.title ?? 'Scene',
        command: 'revision',
        label: instruction.slice(0, 60),
        group: 'adventure',
        original: content.slice(range.from, range.to),
        proposed: revised,
        promptId: 'builtin:adventure:revise',
        scope: 'selection',
        selRange: range,
      }))
      const now = sessionRef.current ?? s
      write({ ...now, turns: settleTurn(now.turns, turnId, { got: revised, proposed: true }) })
    } catch (e) {
      const err = e as Error
      if (err.name !== 'AbortError') setError(err.message)
      setGhost('')
      const now = sessionRef.current ?? s
      write({ ...now, turns: settleTurn(now.turns, turnId, { got: '' }) })
    } finally { setBusy(false); abortRef.current = null }
  }

  /** Answer a question about the story. Nothing is written to the manuscript. */
  const ask = async (question: string, turnId: string) => {
    const s = sessionRef.current
    const proj = useProjectStore.getState().project
    if (!s || !proj) return
    setBusy(true); setError(null)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const answer = await answerAside({ project: proj, index: mentionIndex, session: s, question, signal: ctrl.signal })
      const now = sessionRef.current ?? s
      write({ ...now, turns: settleTurn(now.turns, turnId, { got: answer }) })
    } catch (e) {
      const err = e as Error
      if (err.name !== 'AbortError') setError(err.message)
      const now = sessionRef.current ?? s
      write({ ...now, turns: settleTurn(now.turns, turnId, { got: '' }) })
    } finally { setBusy(false); abortRef.current = null }
  }

  /** Stand the model down and put the cursor in the manuscript. */
  const handOff = () => {
    abortRef.current?.abort()
    const el = document.querySelector('.adv-page .cm-content') as HTMLElement | null
    el?.focus()
    // Land at the end, which is where the next sentence goes.
    if (el) {
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
  }

  /** Close the current scene and open the next document in the binder. */
  const startNextScene = async (s: AdventureSession): Promise<{ session: AdventureSession; sceneId: ID }> => {
    const proj = useProjectStore.getState().project!
    const siblings = proj.nodes[s.targetFolderId]?.childIds ?? []
    const n = siblings.filter((id) => proj.nodes[id]?.type !== 'folder' && id !== s.spineId).length
    const sceneId = await createNode('scene', `Scene ${n + 1}`, s.targetFolderId)
    // The beats of the scene just finished are its synopsis — the corkboard and
    // the outliner get filled in as a side effect of drafting.
    const closing = s.beats.filter((b) => b.sceneId === s.activeSceneId).map((b) => b.text).join(' ')
    if (closing) {
      applyMutation(await window.api.node.mutate(proj.id, { type: 'updateMeta', id: s.activeSceneId, patch: { synopsis: closing.slice(0, 400) } }))
    }
    return { session: { ...s, activeSceneId: sceneId }, sceneId }
  }

  const endSceneNow = async () => {
    const s = sessionRef.current
    if (!s || busy) return
    setBusy(true); setError(null)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const created = await startNextScene(s)
      undoRef.current = null
      setNotes([])
      write(created.session)
      // A fresh scene with an empty deck is a dead end — the author would have
      // to ask for beats before they could do anything.
      const options = await generateOptions({
        project: useProjectStore.getState().project!,
        index: mentionIndex,
        session: created.session,
        signal: ctrl.signal,
      }).catch(() => [] as AdventureOption[])
      write({ ...created.session, options })
    } catch (e) {
      const err = e as Error
      if (err.name !== 'AbortError') setError(err.message)
    } finally { setBusy(false); abortRef.current = null }
  }

  const regenerate = async () => {
    const s = sessionRef.current
    const proj = useProjectStore.getState().project
    if (!s || !proj || busy) return
    setBusy(true); setError(null)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const options = await generateOptions({ project: proj, index: mentionIndex, session: s, signal: ctrl.signal })
      write({ ...s, options })
    } catch (e) {
      const err = e as Error
      if (err.name !== 'AbortError') setError(err.message)
    } finally { setBusy(false); abortRef.current = null }
  }

  /**
   * Step back one passage: restore the snapshot taken before it, put the deck
   * back the way it was, and remove the scene the beat opened if it is still
   * empty. One level deep on purpose — this is an undo, not a branch tree.
   */
  const stepBack = async () => {
    const s = sessionRef.current
    const undo = undoRef.current
    const proj = useProjectStore.getState().project
    if (!s || !undo || !proj || busy) return
    setBusy(true); setError(null)
    try {
      const { content } = await window.api.snapshot.restore(proj.id, undo.sceneId, undo.snapshotId)
      updateContent(undo.sceneId, content)
      await window.api.doc.write(proj.id, undo.sceneId, content)
      if (undo.spine && proj.nodes[undo.spine.id]) {
        updateContent(undo.spine.id, undo.spine.content)
        await window.api.doc.write(proj.id, undo.spine.id, undo.spine.content)
      }
      if (undo.createdSceneId && !(proj.docs[undo.createdSceneId]?.content ?? '').trim()) {
        applyMutation(await window.api.node.mutate(proj.id, { type: 'delete', id: undo.createdSceneId }))
      }
      undoRef.current = null
      setNotes([])
      write({
        ...s, activeSceneId: undo.sceneId, beats: s.beats.slice(0, -1),
        options: undo.options, summary: undo.summary,
        // The transcript is a record of what happened; an undone turn didn't.
        turns: s.turns.slice(0, -1),
      })
      setToast('Stepped back one passage', 'info')
    } catch (e) {
      setError((e as Error).message)
    } finally { setBusy(false) }
  }

  const fileNote = (note: NoteCandidate) => {
    const now = new Date().toISOString()
    upsertCodexEntry({
      id: uid(), name: note.name, aliases: note.aliases, category: note.category,
      summary: note.summary,
      // Facts arrive unconfirmed: the author filing an entry is agreeing it
      // exists, not vouching for every detail the model read into it.
      facts: note.facts.map((f) => ({ id: uid(), label: f.label, value: f.value, aiGenerated: true, confirmedAt: null })),
      createdAt: now, modifiedAt: now, aiGenerated: true,
    })
    setNotes((p) => p.filter((n) => n.name !== note.name))
  }

  const start = async (choice: SetupChoice) => {
    const proj = useProjectStore.getState().project
    if (!proj || busy) return
    setBusy(true); setError(null)
    try {
      let folderId = choice.folderId
      let sceneId = choice.sceneId

      if (choice.mode === 'continue' && sceneId) {
        folderId = proj.nodes[sceneId]?.parentId ?? null
      }
      if (!folderId) folderId = await createNode('folder', 'Manuscript', null)
      if (choice.mode === 'premise' || !sceneId) sceneId = await createNode('scene', 'Scene 1', folderId)

      const s = newSession({
        targetFolderId: folderId,
        activeSceneId: sceneId,
        premise: choice.premise,
        passageLength: choice.passageLength,
      })
      write(s)
      // Continuing an existing scene: there is prose to react to, so open with a
      // deck rather than making the author invent a beat cold.
      if (choice.mode === 'continue') {
        const ctrl = new AbortController()
        abortRef.current = ctrl
        const options = await generateOptions({ project: useProjectStore.getState().project!, index: mentionIndex, session: s, signal: ctrl.signal }).catch(() => [])
        write({ ...s, options })
      }
    } catch (e) {
      setError((e as Error).message)
    } finally { setBusy(false); abortRef.current = null }
  }

  const endSession = () => {
    abortRef.current?.abort()
    undoRef.current = null
    setNotes([])
    write(null)
  }

  // ⌘Z steps back a passage while this tab has the floor — but never while the
  // author is typing in the editor, where it must stay the editor's undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') || e.shiftKey) return
      const el = e.target as HTMLElement | null
      if (el?.closest('.cm-editor, textarea, input')) return
      if (!undoRef.current || busy) return
      e.preventDefault()
      void stepBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ── render ─────────────────────────────────────────────────────────────────

  const shell = (body: React.ReactNode, running = false) => (
    <ModalShell embedded={embedded} onClose={onClose} maxWidth={1400} label="Adventure">
      <div className={`adv-view${running ? ' running' : ''}`}>{body}</div>
    </ModalShell>
  )

  if (!project) return shell(<div className="adv-setup-note">Open a project first.</div>)
  if (!aiEnabled) return shell(<div className="adv-setup-note">Adventure needs the AI layer switched on.</div>)
  if (!loaded) return shell(null)

  if (!session) {
    return shell(
      <>
        {error && <div className="msg-err adv-err">{error}</div>}
        <AdventureSetup project={project} selectedId={selectedId} busy={busy} onStart={start} />
      </>,
    )
  }

  const opening = session.beats.length === 0 && !sceneContent.trim()

  return shell(
    <>
      <div className="adv-strip">
        <span className="adv-where">
          <Icon name="clapperboard" size={12} />
          {project.nodes[session.targetFolderId]?.title ?? 'Manuscript'} › <b>{scene?.title ?? 'Scene'}</b>
        </span>
        <span className="adv-count">{session.beats.length} beat{session.beats.length === 1 ? '' : 's'}</span>
        <button className="btn sm" onClick={() => setShowSummary((v) => !v)} disabled={!session.summary} aria-expanded={showSummary}>
          Story so far
        </button>
        <div className="adv-strip-sp" />
        {busy && <button className="btn sm" onClick={() => abortRef.current?.abort()}><Icon name="stop" size={12} /> Stop</button>}
        <button className="btn sm" onClick={stepBack} disabled={!undoRef.current || busy} title="Undo the last passage">
          <Icon name="undo" size={12} /> Step back
        </button>
        <button className="btn sm" onClick={endSession} disabled={busy} title="Leave the session (nothing written is removed)">
          End session
        </button>
        {!embedded && <button className="btn sm" onClick={onClose}>Close</button>}
      </div>

      {showSummary && session.summary && <div className="adv-summary">{session.summary}</div>}
      {error && <div className="msg-err adv-err">{error}</div>}

      <div className="adv-body">
        <div className="adv-page">
          {/* The same two wrappers EditorPane uses. Without them the prose runs
              the full width of the pane — the worst line length in the app, on
              the surface an author would spend hours in. */}
          <div className="editor-wrap" style={{ flex: 1, minHeight: 0 }}>
            <div className="editor-col">
              <Editor key={session.activeSceneId} docId={session.activeSceneId} />
            </div>
          </div>
          {ghost && ghostMode === 'append' && (
            <div className="adv-ghost" aria-live="polite">
              <span className="adv-ghost-tag">writing…</span>
              {ghost}
            </div>
          )}
        </div>
        <div className="adv-aside">
          <Transcript turns={session.turns} ghost={ghostMode === 'revise' ? ghost : ''} />
          <NotesInbox
            notes={notes}
            scanning={scanning}
            onFile={fileNote}
            onDismiss={(name) => setNotes((p) => p.filter((n) => n.name !== name))}
            onFileAll={() => { notes.forEach(fileNote); setNotes([]) }}
          />
        </div>
      </div>

      <ChoiceDeck
        options={session.options}
        busy={busy}
        opening={opening}
        length={session.passageLength}
        optionCount={session.optionCount}
        detail={session.optionDetail}
        styleId={session.styleId}
        sceneWords={sceneWords}
        sceneBreakAfter={session.sceneBreakAfter}
        deckOpen={session.deckOpen}
        onChoose={(beat, endScene) => void runBeat(beat, endScene)}
        onSay={(text) => void say(text)}
        onContinue={() => void runBeat('', false, { mode: 'continue' })}
        onHandOff={handOff}
        onToggleDeck={() => { const s = sessionRef.current; if (s) write({ ...s, deckOpen: !s.deckOpen }) }}
        onRegenerate={regenerate}
        onEndScene={endSceneNow}
        onSettings={(patch) => { const s = sessionRef.current; if (s) write({ ...s, ...patch }) }}
      />
    </>,
    true,
  )
}
