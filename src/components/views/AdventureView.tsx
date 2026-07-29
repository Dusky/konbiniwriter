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
import AdventureSetup, { type SetupChoice } from './adventure/AdventureSetup'
import {
  appendPassage, generateOptions, newSession, spineLine, streamOpening, streamPassage,
  takeNotes, updateSummary, words, SPINE_TITLE,
  type AdventureOption, type AdventureSession, type NoteCandidate,
} from '../../lib/adventure'
import { uid } from '@shared/utils'
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
}

export default function AdventureView({ onClose, embedded }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const mentionIndex = useProjectStore((s) => s.mentionIndex)
  const updateContent = useProjectStore((s) => s.updateContent)
  const applyMutation = useProjectStore((s) => s.applyMutation)
  const addSnapshot = useProjectStore((s) => s.addSnapshot)
  const upsertCodexEntry = useProjectStore((s) => s.upsertCodexEntry)
  const aiEnabled = useAIStore((s) => s.enabled)
  const setToast = useShellStore((s) => s.setToast)

  const [session, setSession] = useState<AdventureSession | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ghost, setGhost] = useState('')
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
        const alive = parsed && project.nodes[parsed.activeSceneId] ? parsed : null
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
  const sceneWords = useMemo(() => words(sceneContent), [sceneContent])

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

  const runBeat = async (raw: string, endScene: boolean) => {
    const s = sessionRef.current
    const proj = useProjectStore.getState().project
    if (!s || !proj || busy) return
    const opening = s.beats.length === 0 && !sceneContent.trim()
    // Opening a story from a premise needs no beat — the premise is the beat.
    const beat = raw.trim() || (opening ? s.premise.trim() : '')
    if (!beat) return
    setBusy(true); setError(null); setGhost('')
    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      // Invariant 5's spirit, on every append: a rollback point exists before
      // the model writes a word.
      const snap = await window.api.snapshot.take(proj.id, s.activeSceneId, `Before "${beat.slice(0, 48)}"`, 'auto')
      addSnapshot(s.activeSceneId, snap)
      const undo: UndoPoint = { sceneId: s.activeSceneId, snapshotId: snap.id, createdSceneId: null, spine: null, options: s.options, summary: s.summary }

      const args = { project: proj, index: mentionIndex, session: s, signal: ctrl.signal, onChunk: setGhost }
      const passage = (opening ? await streamOpening({ ...args, session: { ...s, premise: s.premise || beat } })
                               : await streamPassage({ ...args, beat })).trim()
      if (!passage) throw new Error('The model returned an empty passage.')

      await appendTo(s.activeSceneId, passage)
      setGhost('')

      let next: AdventureSession = {
        ...s,
        beats: [...s.beats, { text: beat, sceneId: s.activeSceneId, at: new Date().toISOString() }],
      }

      // The spine is the ledger of decisions, mirrored into the binder so the
      // outline survives even if the session file doesn't.
      const spineId = await ensureSpine(next)
      // Captured before the append so stepping back leaves no orphan line
      // behind — an outline that disagrees with the manuscript is worse than
      // no outline.
      undo.spine = { id: spineId, content: useProjectStore.getState().project?.docs[spineId]?.content ?? '' }
      const startsScene = next.beats.filter((b) => b.sceneId === s.activeSceneId).length === 1
      await appendTo(spineId, spineLine(next.beats[next.beats.length - 1]!, scene?.title ?? 'Scene', startsScene).trimEnd())
      next = { ...next, spineId }

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
    } finally {
      setBusy(false)
      abortRef.current = null
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
      write({ ...s, activeSceneId: undo.sceneId, beats: s.beats.slice(0, -1), options: undo.options, summary: undo.summary })
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
        <AdventureSetup project={project} busy={busy} onStart={start} />
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
          <Editor key={session.activeSceneId} docId={session.activeSceneId} />
          {ghost && (
            <div className="adv-ghost" aria-live="polite">
              <span className="adv-ghost-tag">writing…</span>
              {ghost}
            </div>
          )}
        </div>
        <NotesInbox
          notes={notes}
          scanning={scanning}
          onFile={fileNote}
          onDismiss={(name) => setNotes((p) => p.filter((n) => n.name !== name))}
          onFileAll={() => { notes.forEach(fileNote); setNotes([]) }}
        />
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
        onChoose={runBeat}
        onRegenerate={regenerate}
        onEndScene={endSceneNow}
        onSettings={(patch) => { const s = sessionRef.current; if (s) write({ ...s, ...patch }) }}
      />
    </>,
    true,
  )
}
