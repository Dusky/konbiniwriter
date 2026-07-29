import React, { useCallback, useEffect, useRef, useState } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useProjectStore, descendants } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
import { useAIStore } from '../../store/aiStore'
import { STATUS_META } from '@shared/utils'
import {
  konbiniExtensions, focusModeEffect, makeTypewriterPlugin,
} from './extensions'
import { livePreview } from './livePreview'
import {
  buildBuffer, extractSegments, scriveningsExtensions, scrivSelectFacet,
  setScenesEffect, scrivBypass, SEP_TOKEN, sceneAtPos, sceneRangeForRange, type SceneMeta,
} from './scriveningsSep'
import { useScriveningsSave } from '../../hooks/useScriveningsSave'
import CowriteBar from './CowriteBar'
import BeatBox from './BeatBox'
import { createProposal } from '../../lib/ProposalService'
import { BEAT_PROMPT_ID } from '../../lib/beat'

interface Props {
  folderId: string
  /**
   * What clicking a scene header does. The main pane moves the global
   * selection; a split pane opens the scene in *itself*, because hijacking the
   * global selection from the right pane would yank the left one somewhere the
   * author didn't ask to go.
   */
  onOpenScene?: (id: string) => void
}

// Ordered writable descendants of the folder + their divider metadata.
function readScenes(folderId: string): { ids: string[]; meta: SceneMeta[] } {
  const project = useProjectStore.getState().project
  if (!project) return { ids: [], meta: [] }
  const ids = descendants(project, folderId).filter((id) => project.nodes[id]?.type !== 'folder')
  const meta = ids.map((id) => {
    const n = project.nodes[id]
    const color = STATUS_META[n.meta.status]?.color ?? 'var(--border-2)'
    return { id, title: n?.title ?? 'Untitled', color }
  })
  return { ids, meta }
}

const structuralSig = (meta: SceneMeta[]) => meta.map((m) => m.id + '\u0000' + m.title + '\u0000' + m.color).join('\u0001')

export default function Scrivenings({ folderId, onOpenScene }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const typewriterCompartment = useRef(new Compartment())
  const livePreviewCompartment = useRef(new Compartment())

  const updateContent = useProjectStore((s) => s.updateContent)
  const setCursor = useProjectStore((s) => s.setCursor)
  const setSaveStatus = useProjectStore((s) => s.setSaveStatus)
  const selectNode = useProjectStore((s) => s.selectNode)
  // Read through a ref: the CM state is built once per folder, so capturing the
  // prop directly would freeze the first one it saw.
  const onOpenSceneRef = useRef(onOpenScene)
  onOpenSceneRef.current = onOpenScene
  const focusMode = useProjectStore((s) => s.focusMode)
  const typewriterMode = useShellStore((s) => s.typewriterMode)
  const livePreviewOn = useShellStore((s) => s.livePreview)
  const queueProposal = useProjectStore((s) => s.queueProposal)
  const aiEnabled = useAIStore((s) => s.enabled)
  // Subscribe so external content changes / structural edits re-run the sync effect.
  const project = useProjectStore((s) => s.project)

  const stageSave = useScriveningsSave()

  const idsRef = useRef<string[]>([])
  const lastWrittenRef = useRef<Record<string, string>>({})
  const sigRef = useRef<string>('')

  // AI cowrite (selection) + beat (cursor) — mapped from the combined buffer to
  // the individual scene the edit belongs to.
  const [cowrite, setCowrite] = useState<{ sceneId: string; selection: string; selRange: { from: number; to: number }; anchorRect: DOMRect } | null>(null)
  const [beat, setBeat] = useState<{ sceneId: string; offset: number; preceding: string; anchorRect: DOMRect } | null>(null)

  // Write-back: split the combined buffer and push each changed scene through the
  // canonical updateContent seam, staging it for the batched disk save.
  const handleChange = (full: string) => {
    const ids = idsRef.current
    const parts = extractSegments(full)
    if (parts.length !== ids.length) return // corruption net (should never fire — tokens are protected)
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      if (parts[i] !== lastWrittenRef.current[id]) {
        lastWrittenRef.current[id] = parts[i]
        updateContent(id, parts[i])
        stageSave(id, parts[i])
      }
    }
  }

  const handleCursor = (line: number, col: number) => setCursor({ line, col })

  // Mount / remount when the folder changes.
  useEffect(() => {
    if (!containerRef.current) return
    const { ids, meta } = readScenes(folderId)
    idsRef.current = ids
    lastWrittenRef.current = {}
    for (const id of ids) lastWrittenRef.current[id] = useProjectStore.getState().project?.docs[id]?.content ?? ''
    sigRef.current = structuralSig(meta)
    const doc = buildBuffer(ids.map((id) => lastWrittenRef.current[id]))

    const state = EditorState.create({
      doc,
      extensions: [
        ...konbiniExtensions(handleChange, handleCursor),
        ...scriveningsExtensions,
        scrivSelectFacet.of((id) => (onOpenSceneRef.current ?? selectNode)(id)),
        livePreviewCompartment.current.of(livePreviewOn ? livePreview : []),
        typewriterCompartment.current.of(typewriterMode ? makeTypewriterPlugin() : []),
      ],
    })
    const view = new EditorView({ state, parent: containerRef.current })
    view.dispatch({ effects: setScenesEffect.of(meta), annotations: scrivBypass.of(true) })
    viewRef.current = view

    view.focus()
    const head = view.state.selection.main.head
    const initLine = view.state.doc.lineAt(head)
    handleCursor(initLine.number, head - initLine.from + 1)

    return () => { view.destroy(); viewRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId])

  // Reconcile store → editor for changes we didn't originate.
  useEffect(() => {
    const view = viewRef.current
    if (!view || !project) return
    const { ids, meta } = readScenes(folderId)
    const sig = structuralSig(meta)

    // (a) Structural change (add/remove/reorder/rename/status) → rebuild the buffer.
    if (sig !== sigRef.current) {
      idsRef.current = ids
      const next: Record<string, string> = {}
      for (const id of ids) next[id] = project.docs[id]?.content ?? ''
      lastWrittenRef.current = next
      sigRef.current = sig
      const doc = buildBuffer(ids.map((id) => next[id]))
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: doc },
        effects: setScenesEffect.of(meta),
        annotations: scrivBypass.of(true),
      })
      return
    }

    // (b) External content change to a member scene (snapshot restore / future AI).
    // Our own edits are ignored because lastWrittenRef is pre-seeded before write.
    // Locate each scene's clean-content range by the (intact) token positions and
    // replace only that range, preserving the surrounding SEP newlines.
    const text = view.state.doc.toString()
    const tokens: number[] = []
    for (let c = 0, idx = 0; (idx = text.indexOf(SEP_TOKEN, c)) !== -1; c = idx + SEP_TOKEN.length) tokens.push(idx)
    if (tokens.length !== ids.length - 1) return // buffer/model out of sync; next structural pass rebuilds
    const last = ids.length - 1
    const changes: { from: number; to: number; insert: string }[] = []
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      const stored = project.docs[id]?.content ?? ''
      if (stored === lastWrittenRef.current[id]) continue
      let rawFrom = i === 0 ? 0 : tokens[i - 1] + SEP_TOKEN.length
      let rawTo = i === last ? text.length : tokens[i]
      if (i > 0 && text[rawFrom] === '\n') rawFrom += 1         // '\n' after the previous token
      if (i < last && text[rawTo - 1] === '\n') rawTo -= 1      // '\n' before the next token
      lastWrittenRef.current[id] = stored
      changes.push({ from: rawFrom, to: rawTo, insert: stored })
      // The store changed from outside our editing (snapshot restore, applied AI
      // proposal). updateContent only touched the store — persist it to disk too,
      // since our batched save is otherwise driven by buffer keystrokes and the
      // pre-seeded lastWrittenRef above will suppress it.
      stageSave(id, stored)
    }
    // One dispatch: all change specs are positioned against the current doc and
    // applied atomically, so no stale-offset issue across multiple scenes.
    if (changes.length) view.dispatch({ changes, annotations: scrivBypass.of(true) })
  }, [project, folderId, selectNode, stageSave])

  // Focus mode → CM effect.
  useEffect(() => {
    const view = viewRef.current
    if (view) view.dispatch({ effects: focusModeEffect.of(focusMode) })
  }, [focusMode])

  // Typewriter mode → compartment reconfigure.
  useEffect(() => {
    const view = viewRef.current
    if (view) view.dispatch({ effects: typewriterCompartment.current.reconfigure(typewriterMode ? makeTypewriterPlugin() : []) })
  }, [typewriterMode])

  // Render mode (live preview vs raw) → compartment reconfigure.
  useEffect(() => {
    const view = viewRef.current
    if (view) view.dispatch({ effects: livePreviewCompartment.current.reconfigure(livePreviewOn ? livePreview : []) })
  }, [livePreviewOn])

  // Focus restore after a modal closes (dispatched from Studio).
  useEffect(() => {
    const handler = () => viewRef.current?.focus()
    window.addEventListener('konbini:focus-editor', handler)
    return () => window.removeEventListener('konbini:focus-editor', handler)
  }, [])

  // Guard against a saveStatus stuck on 'saving' if the folder had no scenes.
  useEffect(() => {
    if (idsRef.current.length === 0) setSaveStatus('saved', new Date().toISOString())
  }, [folderId, setSaveStatus])

  // ── AI: cowrite on selection, beat at the cursor — mapped to the scene ──────
  const handleMouseUp = useCallback(() => {
    if (!aiEnabled) { return }
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    if (from === to) { setCowrite(null); return }
    const raw = view.state.doc.sliceString(from, to)
    const selection = raw.trim()
    if (selection.length < 3) { setCowrite(null); return }
    const selFrom = from + (raw.length - raw.trimStart().length)
    const selTo = to - (raw.length - raw.trimEnd().length)
    // Only offer cowrite when the selection sits inside a single scene.
    const mapped = sceneRangeForRange(view.state.doc.toString(), idsRef.current, selFrom, selTo)
    if (!mapped) { setCowrite(null); return }
    const coords = view.coordsAtPos(from)
    if (!coords) { setCowrite(null); return }
    setCowrite({ sceneId: mapped.sceneId, selection, selRange: { from: mapped.from, to: mapped.to }, anchorRect: new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top) })
  }, [aiEnabled])

  const openBeat = useCallback(() => {
    const view = viewRef.current
    if (!view || !aiEnabled) return
    const head = view.state.selection.main.head
    const loc = sceneAtPos(view.state.doc.toString(), idsRef.current, head)
    if (!loc) return
    const coords = view.coordsAtPos(head)
    const rect = coords ? new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top) : new DOMRect(200, 200, 0, 16)
    const sceneContent = useProjectStore.getState().project?.docs[loc.sceneId]?.content ?? ''
    const preceding = sceneContent.slice(Math.max(0, loc.offset - 1500), loc.offset)
    setBeat({ sceneId: loc.sceneId, offset: loc.offset, preceding, anchorRect: rect })
  }, [aiEnabled])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j' && !e.shiftKey && !e.altKey) {
        if (!aiEnabled) return
        e.preventDefault()
        openBeat()
      }
    }
    const evt = () => openBeat()
    window.addEventListener('keydown', key)
    window.addEventListener('konbini:generate-beat', evt)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('konbini:generate-beat', evt) }
  }, [aiEnabled, openBeat])

  const insertBeat = useCallback((text: string, description: string) => {
    const b = beat
    const p = useProjectStore.getState().project
    if (!b || !p) return
    queueProposal(createProposal({
      docId: b.sceneId,
      docTitle: p.nodes[b.sceneId]?.title ?? 'Document',
      command: 'beat',
      label: `Beat: ${description.slice(0, 40)}${description.length > 40 ? '…' : ''}`,
      group: 'cowrite',
      original: '',
      proposed: text,
      promptId: BEAT_PROMPT_ID,
      scope: 'selection',
      selRange: { from: b.offset, to: b.offset },
    }))
    setBeat(null)
  }, [beat, queueProposal])

  return (
    <div style={{ minHeight: 0, position: 'relative' }} onMouseUp={handleMouseUp}>
      <div ref={containerRef} />
      {cowrite && (
        <CowriteBar
          docId={cowrite.sceneId}
          selection={cowrite.selection}
          selRange={cowrite.selRange}
          anchorRect={cowrite.anchorRect}
          onClose={() => setCowrite(null)}
        />
      )}
      {beat && (
        <BeatBox
          docId={beat.sceneId}
          preceding={beat.preceding}
          anchorRect={beat.anchorRect}
          onClose={() => setBeat(null)}
          onInsert={insertBeat}
        />
      )}
    </div>
  )
}
