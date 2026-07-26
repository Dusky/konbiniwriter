import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { focusModeEffect, konbiniExtensions, makeTypewriterPlugin, setSlopSpansEffect, setCommentSpansEffect, commentField, setNameSlipsEffect, nameSlipField, setSpokenRangeEffect, type SlopSpan, type CommentSpan, type NameSlipSpan } from './extensions'
import { anchoredFor, type Comment } from '@shared/comments'
import { buildVocabulary, findNameSlips } from '@shared/dictionary'
import { sentenceIndexAt, splitSentences } from '@shared/speech'
import { readAloud } from '../../lib/ReadAloud'
import ReadAloudBar from './ReadAloudBar'
import { livePreview } from './livePreview'
import { useProjectStore } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
import { useAutosave } from '../../hooks/useAutosave'
import { useAIStore } from '../../store/aiStore'
import CowriteBar from './CowriteBar'
import BeatBox from './BeatBox'
import ContextMenu, { type MenuItem } from '../common/ContextMenu'
import Icon from '../common/Icon'
import { createProposal } from '../../lib/ProposalService'
import { BEAT_PROMPT_ID } from '../../lib/beat'
import { COWRITE_COMMANDS, type CowriteCommand } from '../../lib/cowrite'
import { promptRegistry } from '../../lib/PromptRegistry'
import { streamCompletion } from '../../lib/AIClient'

// Editor right-click behaviour. 'selection' shows the custom menu only when
// text is selected (so the browser's native menu — with spellcheck — still
// appears otherwise). Flip to 'always' to show the custom menu on every
// right-click.
const EDITOR_MENU_MODE: 'selection' | 'always' = 'selection'

/**
 * The comment highlights a document should be showing right now.
 *
 * Orphaned comments are excluded: their stored offsets no longer describe any
 * real span, so there is nothing honest to paint.
 */
function commentSpansFor(comments: Comment[], docId: string, content: string): CommentSpan[] {
  return anchoredFor(comments, docId, content)
    .filter((c) => !c.orphaned && c.live.to > c.live.from)
    .map((c) => ({ id: c.id, from: c.live.from, to: c.live.to, resolved: c.resolved }))
}

interface Props {
  docId: string
}

export default function Editor({ docId }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const typewriterCompartment = useRef(new Compartment())
  const livePreviewCompartment = useRef(new Compartment())

  const project = useProjectStore((s) => s.project)
  const updateContent = useProjectStore((s) => s.updateContent)
  const setSaveStatus = useProjectStore((s) => s.setSaveStatus)
  const focusMode = useProjectStore((s) => s.focusMode)
  const aiEnabled = useAIStore((s) => s.enabled)
  const slopAutoRun = useAIStore((s) => s.slopAutoRun)
  const setSlopSpans = useProjectStore((s) => s.setSlopSpans)
  const setSlopRunning = useProjectStore((s) => s.setSlopRunning)
  const setCursor = useProjectStore((s) => s.setCursor)
  const pendingReveal = useProjectStore((s) => s.pendingReveal)
  const setPendingReveal = useProjectStore((s) => s.setPendingReveal)
  const typewriterMode = useShellStore((s) => s.typewriterMode)
  const livePreviewOn = useShellStore((s) => s.livePreview)
  const setRailPanel = useShellStore((s) => s.setRailPanel)
  const queueProposal = useProjectStore((s) => s.queueProposal)
  const comments = useProjectStore((s) => s.comments)
  const addComment = useProjectStore((s) => s.addComment)
  const remapComment = useProjectStore((s) => s.remapComment)
  const setFocusedComment = useProjectStore((s) => s.setFocusedComment)
  const codex = useProjectStore((s) => s.codex)
  const dictionary = useProjectStore((s) => s.dictionary)
  const addDictionaryWord = useProjectStore((s) => s.addDictionaryWord)

  const content = project?.docs[docId]?.content ?? ''

  // Codex names, aliases, and document titles are all project vocabulary.
  const vocabulary = useMemo(
    () => buildVocabulary(project, codex, dictionary),
    [project, codex, dictionary],
  )

  const [cowrite, setCowrite] = useState<{ selection: string; selRange: { from: number; to: number }; anchorRect: DOMRect; autoRun?: CowriteCommand } | null>(null)
  const [beat, setBeat] = useState<{ anchorRect: DOMRect; cursor: number; preceding: string } | null>(null)
  const [editorMenu, setEditorMenu] = useState<{ x: number; y: number; hasSelection: boolean; slip: NameSlipSpan | null } | null>(null)
  const [wikilinkTip, setWikilinkTip] = useState<{ title: string; synopsis: string; preview: string; x: number; y: number } | null>(null)

  const [readAloudOpen, setReadAloudOpen] = useState(false)

  // Find & Replace state
  const [findReplaceOpen, setFindReplaceOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [matches, setMatches] = useState<number[]>([])
  const [currentMatch, setCurrentMatch] = useState(0)
  const findInputRef = useRef<HTMLInputElement>(null)

  // Run slop proof on current doc — called from Toolbar
  const runProof = useCallback(async () => {
    const view = viewRef.current
    if (!view || !aiEnabled) return
    const text = view.state.doc.toString()
    if (!text.trim()) return

    setSlopRunning(true)
    const template = promptRegistry.get('builtin:evaluation:slop')
    if (!template) { setSlopRunning(false); return }
    const rendered = promptRegistry.render('builtin:evaluation:slop', { content: text })

    let full = ''
    await streamCompletion(
      [{ role: 'user', content: rendered }],
      { model: template.model, maxTokens: template.maxTokens, temperature: template.temperature },
      {
        onChunk: (c) => { full += c },
        onDone: (result) => {
          try {
            const raw = result.match(/\[[\s\S]*\]/)?.[0] ?? '[]'
            const flags = JSON.parse(raw) as Array<{ excerpt: string; reason: string; severity: 'low' | 'medium' | 'high' }>
            const spans: SlopSpan[] = []
            for (const flag of flags) {
              let idx = 0
              while (idx < text.length) {
                const pos = text.indexOf(flag.excerpt, idx)
                if (pos === -1) break
                spans.push({ from: pos, to: pos + flag.excerpt.length, reason: flag.reason, severity: flag.severity })
                idx = pos + flag.excerpt.length
              }
            }
            setSlopSpans(spans)
            if (view) view.dispatch({ effects: setSlopSpansEffect.of(spans) })
          } catch {
            setSlopSpans([])
          }
        },
        onError: () => setSlopRunning(false),
      },
    )
  }, [aiEnabled, setSlopSpans, setSlopRunning])

  // Expose runProof globally so Toolbar can call it without prop drilling
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__konbiniRunProof = runProof
    return () => { delete (window as unknown as Record<string, unknown>).__konbiniRunProof }
  }, [runProof])

  // Alt+P keyboard shortcut for slop proof
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'p' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        runProof()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [runProof])

  // Open the beat generator at the cursor (⌘/Ctrl+J).
  const openBeat = useCallback(() => {
    const view = viewRef.current
    if (!view || !aiEnabled) return
    const head = view.state.selection.main.head
    const coords = view.coordsAtPos(head)
    const rect = coords
      ? new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top)
      : new DOMRect(200, 200, 0, 16)
    const preceding = view.state.doc.sliceString(Math.max(0, head - 1500), head)
    setBeat({ anchorRect: rect, cursor: head, preceding })
  }, [aiEnabled])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j' && !e.shiftKey && !e.altKey) {
        if (!aiEnabled) return
        e.preventDefault()
        openBeat()
      }
    }
    const evt = () => openBeat()
    window.addEventListener('keydown', handler)
    window.addEventListener('konbini:generate-beat', evt)
    return () => { window.removeEventListener('keydown', handler); window.removeEventListener('konbini:generate-beat', evt) }
  }, [aiEnabled, openBeat])

  // Insert an accepted beat as a reviewable proposal at the captured cursor.
  const insertBeat = useCallback((text: string, description: string) => {
    if (!project) return
    const from = beat?.cursor ?? viewRef.current?.state.selection.main.head ?? 0
    queueProposal(createProposal({
      docId,
      docTitle: project.nodes[docId]?.title ?? 'Document',
      command: 'beat',
      label: `Beat: ${description.slice(0, 40)}${description.length > 40 ? '…' : ''}`,
      group: 'cowrite',
      original: '',
      proposed: text,
      promptId: BEAT_PROMPT_ID,
      scope: 'selection',
      selRange: { from, to: from },
    }))
    setBeat(null)
  }, [project, docId, beat, queueProposal])

  // Focus restore after a modal closes (dispatched from Studio).
  useEffect(() => {
    const handler = () => viewRef.current?.focus()
    window.addEventListener('konbini:focus-editor', handler)
    return () => window.removeEventListener('konbini:focus-editor', handler)
  }, [])

  // Auto-run slop proof 30s after idle when slopAutoRun is enabled
  const slopAutoRunTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (slopAutoRunTimerRef.current) clearTimeout(slopAutoRunTimerRef.current)
  }, [])

  // Autosave hook — fires 700ms after content changes
  useAutosave(docId)

  const handleChange = useCallback(
    (newContent: string) => {
      setSaveStatus('saving')
      updateContent(docId, newContent)
      if (slopAutoRun && aiEnabled) {
        if (slopAutoRunTimerRef.current) clearTimeout(slopAutoRunTimerRef.current)
        slopAutoRunTimerRef.current = setTimeout(() => {
          if (!useProjectStore.getState().slopRunning) runProof()
        }, 30_000)
      }
    },
    [docId, updateContent, setSaveStatus, slopAutoRun, aiEnabled, runProof]
  )

  const handleCursor = useCallback(
    (line: number, col: number) => setCursor({ line, col }),
    [setCursor]
  )

  // ── Comments ───────────────────────────────────────────────────────────────

  // CodeMirror has already mapped these anchors through the change; push the
  // new positions (and the text they now cover) back to the store. A span that
  // collapsed to nothing is skipped deliberately: leaving the old quote in
  // place lets `reanchor` mark the comment orphaned instead of silently
  // re-pointing it at whatever text moved into those offsets.
  const handleCommentSpans = useCallback((spans: CommentSpan[]) => {
    const view = viewRef.current
    if (!view) return
    const doc = view.state.doc
    for (const s of spans) {
      if (s.from >= s.to) continue
      remapComment(s.id, { from: s.from, to: s.to, quote: doc.sliceString(s.from, s.to) })
    }
  }, [remapComment])

  // Keep the editor's highlights in step with the store. This only covers
  // *changes*; the initial set is seeded by the mount effect below, which runs
  // after this one and is the first point at which a view exists.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const next = commentSpansFor(comments, docId, content)
    const cur = view.state.field(commentField)
    const same = cur.length === next.length && cur.every((s, i) =>
      s.id === next[i].id && s.from === next[i].from && s.to === next[i].to && s.resolved === next[i].resolved)
    if (same) return
    view.dispatch({ effects: setCommentSpansEffect.of(next) })
  }, [comments, content, docId])

  // ── Name slips ─────────────────────────────────────────────────────────────

  // Recomputed after typing settles rather than on every keystroke: the token
  // under the caret is half-written most of the time, and flagging it as a
  // mistake while the writer is still typing it is pure noise.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (!vocabulary.length) {
      if (view.state.field(nameSlipField).length) view.dispatch({ effects: setNameSlipsEffect.of([]) })
      return
    }
    const t = setTimeout(() => {
      const v = viewRef.current
      if (!v) return
      const slips = findNameSlips(v.state.doc.toString(), vocabulary)
      v.dispatch({ effects: setNameSlipsEffect.of(slips) })
    }, 600)
    return () => clearTimeout(t)
  }, [content, docId, vocabulary])

  /** The name slip under a document position, if any. */
  const slipAt = useCallback((pos: number): NameSlipSpan | null => {
    const view = viewRef.current
    if (!view) return null
    return view.state.field(nameSlipField).find((s) => pos >= s.from && pos <= s.to) ?? null
  }, [])

  const fixSlip = useCallback((slip: NameSlipSpan) => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ changes: { from: slip.from, to: slip.to, insert: slip.suggestion } })
    view.focus()
  }, [])

  // ── Read aloud ─────────────────────────────────────────────────────────────

  // Reading starts at the caret, not the top: proofing is something you do to
  // the paragraph you just wrote.
  const startReading = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    const text = view.state.doc.toString()
    const head = view.state.selection.main.head
    readAloud.start(text, sentenceIndexAt(splitSentences(text), head))
  }, [])

  useEffect(() => {
    const onStart = () => startReading()
    const onToggle = () => {
      if (readAloudOpen) { readAloud.stop(); setReadAloudOpen(false); return }
      // Read the caret BEFORE opening the bar. Inserting it above the editor
      // reflows the contenteditable, and the browser re-places the selection at
      // the end of the document when that happens — so a deferred read would
      // always start from the bottom instead of from where the writer is.
      startReading()
      setReadAloudOpen(true)
    }
    const onKey = (e: KeyboardEvent) => {
      // Not Ctrl+Shift+U: that's the IBus Unicode-input sequence on Linux, and
      // it collapses the caret to the end of the field before we see the event.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        onToggle()
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('konbini:read-aloud-start', onStart)
    window.addEventListener('konbini:read-aloud', onToggle)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('konbini:read-aloud-start', onStart)
      window.removeEventListener('konbini:read-aloud', onToggle)
    }
  }, [startReading, readAloudOpen])

  // Follow the spoken sentence: highlight it and keep it on screen.
  useEffect(() => readAloud.subscribe((st) => {
    const view = viewRef.current
    if (!view) return
    const s = st.speaking && st.index >= 0 ? st.sentences[st.index] : null
    const range = s && s.to <= view.state.doc.length ? { from: s.from, to: s.to } : null
    view.dispatch({
      effects: range
        ? [setSpokenRangeEffect.of(range), EditorView.scrollIntoView(range.from, { y: 'center' })]
        : [setSpokenRangeEffect.of(null)],
    })
  }), [])

  // Speech outlives the component unless it's stopped; a voice reading a
  // document that is no longer open is the worst possible bug here.
  useEffect(() => () => readAloud.stop(), [docId])

  const addCommentAtSelection = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    if (from === to) {
      useShellStore.getState().setToast('Select the text you want to comment on.')
      return
    }
    const id = addComment({ docId, from, to, body: '' })
    if (!id) return
    setRailPanel('comments')
    setFocusedComment(id)
  }, [docId, addComment, setRailPanel, setFocusedComment])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        addCommentAtSelection()
      }
    }
    const evt = () => addCommentAtSelection()
    window.addEventListener('keydown', handler)
    window.addEventListener('konbini:add-comment', evt)
    return () => { window.removeEventListener('keydown', handler); window.removeEventListener('konbini:add-comment', evt) }
  }, [addCommentAtSelection])

  // Clicking a highlighted span surfaces its note in the rail.
  const handleCommentClick = useCallback((e: React.MouseEvent) => {
    const el = (e.target as HTMLElement | null)?.closest?.('[data-comment-id]')
    const id = el?.getAttribute('data-comment-id')
    if (!id) return
    setRailPanel('comments')
    setFocusedComment(id)
  }, [setRailPanel, setFocusedComment])

  // Show co-write bar on mouseup if there's a selection and AI is enabled
  const handleMouseUp = useCallback(() => {
    if (!aiEnabled) return
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    if (from === to) { setCowrite(null); return }
    const raw = view.state.doc.sliceString(from, to)
    const selection = raw.trim()
    if (selection.length < 3) { setCowrite(null); return }
    const selFrom = from + (raw.length - raw.trimStart().length)
    const selTo = to - (raw.length - raw.trimEnd().length)
    // Get bounding rect of selection anchor
    const coords = view.coordsAtPos(from)
    if (!coords) { setCowrite(null); return }
    setCowrite({ selection, selRange: { from: selFrom, to: selTo }, anchorRect: new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top) })
  }, [aiEnabled])

  // ── Right-click context menu ───────────────────────────────────────────────

  const clipboardWrite = async (text: string) => { try { await navigator.clipboard.writeText(text) } catch { /* denied */ } }

  const doCopy = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    if (from !== to) void clipboardWrite(view.state.doc.sliceString(from, to))
  }, [])

  const doCut = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    if (from === to) return
    void clipboardWrite(view.state.doc.sliceString(from, to))
    view.dispatch({ changes: { from, to, insert: '' } })
    view.focus()
  }, [])

  const doPaste = useCallback(async () => {
    const view = viewRef.current
    if (!view) return
    let text = ''
    try { text = await navigator.clipboard.readText() } catch { return }
    if (!text) return
    const { from, to } = view.state.selection.main
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } })
    view.focus()
  }, [])

  const doSelectAll = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
    view.focus()
  }, [])

  const startCowrite = useCallback((cmd: CowriteCommand) => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    const raw = view.state.doc.sliceString(from, to)
    const selection = raw.trim()
    if (selection.length < 1) return
    const selFrom = from + (raw.length - raw.trimStart().length)
    const selTo = to - (raw.length - raw.trimEnd().length)
    const coords = view.coordsAtPos(from)
    const rect = coords
      ? new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top)
      : new DOMRect(100, 100, 0, 16)
    setCowrite({ selection, selRange: { from: selFrom, to: selTo }, anchorRect: rect, autoRun: cmd })
  }, [])

  const editorMenuItems = useCallback((hasSelection: boolean, slip: NameSlipSpan | null): MenuItem[] => {
    const items: MenuItem[] = []
    // A misspelled name is the reason the menu was opened; put it first.
    if (slip) {
      items.push({ label: `Change to “${slip.suggestion}”`, action: () => fixSlip(slip) })
      items.push({ label: `Add “${slip.word}” to Dictionary`, action: () => addDictionaryWord(slip.word) })
      items.push({ label: '---', action: () => {} })
    }
    if (hasSelection) {
      items.push({ label: 'Cut', action: doCut }, { label: 'Copy', action: doCopy })
    }
    items.push({ label: 'Paste', action: () => { void doPaste() } })
    if (!hasSelection) items.push({ label: 'Select All', action: doSelectAll })
    if (hasSelection) {
      items.push({ label: '---', action: () => {} })
      items.push({ label: 'Add Comment', action: addCommentAtSelection })
    }
    if (aiEnabled && hasSelection) {
      items.push({ label: '---', action: () => {} })
      for (const c of COWRITE_COMMANDS) items.push({ label: c.label, action: () => startCowrite(c.id) })
    }
    items.push({ label: '---', action: () => {} })
    items.push({ label: 'History & Snapshots', action: () => setRailPanel('history') })
    return items
  }, [aiEnabled, doCut, doCopy, doPaste, doSelectAll, startCowrite, setRailPanel, addCommentAtSelection, fixSlip, addDictionaryWord])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const view = viewRef.current
    if (!view) return
    const sel = view.state.selection.main
    const hasSelection = sel.from !== sel.to
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
    const slip = pos === null ? null : slipAt(pos)
    // In 'selection' mode, fall through to the browser's native menu (which
    // carries spellcheck suggestions) when nothing is selected — unless we have
    // something better to offer, i.e. a name we know is misspelled.
    if (EDITOR_MENU_MODE === 'selection' && !hasSelection && !slip) return
    e.preventDefault()
    setEditorMenu({ x: e.clientX, y: e.clientY, hasSelection, slip })
  }, [slipAt])

  // Mount / remount when docId changes
  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: content,
      extensions: [
        ...konbiniExtensions(handleChange, handleCursor, handleCommentSpans),
        livePreviewCompartment.current.of(livePreviewOn ? livePreview : []),
        typewriterCompartment.current.of(typewriterMode ? makeTypewriterPlugin() : []),
      ],
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view

    // Seed comment highlights for the document just opened. The sync effect
    // above can't do it: React runs effects in declaration order, so it fires
    // while viewRef is still null and then won't re-run until a dep changes.
    const initialSpans = commentSpansFor(useProjectStore.getState().comments, docId, content)
    if (initialSpans.length) view.dispatch({ effects: setCommentSpansEffect.of(initialSpans) })

    // Focus the editor and publish the initial cursor position
    view.focus()
    const head = view.state.selection.main.head
    const initLine = view.state.doc.lineAt(head)
    handleCursor(initLine.number, head - initLine.from + 1)

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Intentionally only re-run when docId changes (not content)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  // Sync external content changes (snapshot restore) without recreating the view
  const prevDocIdRef = useRef(docId)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    // Skip on initial mount (handled above)
    if (prevDocIdRef.current !== docId) { prevDocIdRef.current = docId; return }
    const current = view.state.doc.toString()
    if (current !== content) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content },
      })
    }
  }, [content, docId])

  // Reveal a search hit: select the range, scroll it to center, focus.
  useEffect(() => {
    if (!pendingReveal || pendingReveal.docId !== docId) return
    const view = viewRef.current
    if (!view) return
    const max = view.state.doc.length
    const from = Math.min(pendingReveal.from, max)
    const to = Math.min(from + pendingReveal.len, max)
    view.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: 'center' }),
    })
    view.focus()
    setPendingReveal(null)
  }, [pendingReveal, docId, content, setPendingReveal])

  // Wikilink hover tooltip
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const view = viewRef.current
    if (!view || !project) { setWikilinkTip(null); return }
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
    if (pos === null) { setWikilinkTip(null); return }
    const text = view.state.doc.toString()
    const re = /\[\[([^\]]+)\]\]/g
    let m: RegExpExecArray | null
    let found: string | null = null
    while ((m = re.exec(text)) !== null) {
      if (m.index <= pos && pos <= m.index + m[0].length) { found = m[1]; break }
    }
    if (!found) { setWikilinkTip(null); return }
    const target = Object.values(project.nodes).find(
      (n) => n.title.toLowerCase() === found!.toLowerCase()
    )
    if (!target) { setWikilinkTip(null); return }
    const preview = (project.docs[target.id]?.content ?? '').slice(0, 200).trim()
    setWikilinkTip({ title: target.title, synopsis: target.meta.synopsis, preview, x: e.clientX, y: e.clientY })
  }, [project])

  // Find & Replace logic
  const searchMatches = useCallback((text: string, doc: string): number[] => {
    if (!text) return []
    const results: number[] = []
    let idx = 0
    while (idx <= doc.length - text.length) {
      const pos = doc.indexOf(text, idx)
      if (pos === -1) break
      results.push(pos)
      idx = pos + 1
    }
    return results
  }, [])

  useEffect(() => {
    if (!findReplaceOpen) return
    const view = viewRef.current
    if (!view) { setMatches([]); return }
    const doc = view.state.doc.toString()
    const found = searchMatches(findText, doc)
    setMatches(found)
    setCurrentMatch(0)
    if (found.length > 0) {
      const pos = found[0]
      view.dispatch({
        selection: { anchor: pos, head: pos + findText.length },
        effects: EditorView.scrollIntoView(pos, { y: 'center' }),
      })
    }
  }, [findText, findReplaceOpen, searchMatches])

  const goToMatch = useCallback((idx: number) => {
    const view = viewRef.current
    if (!view || matches.length === 0) return
    const pos = matches[idx]
    view.dispatch({
      selection: { anchor: pos, head: pos + findText.length },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    })
    view.focus()
  }, [matches, findText])

  const goNext = useCallback(() => {
    if (matches.length === 0) return
    const next = (currentMatch + 1) % matches.length
    setCurrentMatch(next)
    goToMatch(next)
  }, [currentMatch, matches, goToMatch])

  const goPrev = useCallback(() => {
    if (matches.length === 0) return
    const prev = (currentMatch - 1 + matches.length) % matches.length
    setCurrentMatch(prev)
    goToMatch(prev)
  }, [currentMatch, matches, goToMatch])

  const doReplace = useCallback(() => {
    const view = viewRef.current // eslint-disable-line @typescript-eslint/no-shadow
    if (!view || matches.length === 0) return
    const pos = matches[currentMatch]
    const sel = view.state.selection.main
    // Only replace if selection matches current match
    if (sel.from === pos && sel.to === pos + findText.length) {
      view.dispatch({ changes: { from: pos, to: pos + findText.length, insert: replaceText } })
      // Re-search after change
      const doc = view.state.doc.toString()
      const found = searchMatches(findText, doc)
      setMatches(found)
      const next = Math.min(currentMatch, found.length - 1)
      setCurrentMatch(next >= 0 ? next : 0)
      if (found.length > 0 && next >= 0) goToMatch(next)
    } else {
      goToMatch(currentMatch)
    }
  }, [matches, currentMatch, findText, replaceText, searchMatches, goToMatch])

  const doReplaceAll = useCallback(() => {
    const view = viewRef.current
    if (!view || matches.length === 0) return
    // Replace from last to first so positions stay valid
    const changes = [...matches].reverse().map((pos) => ({
      from: pos, to: pos + findText.length, insert: replaceText,
    }))
    view.dispatch({ changes })
    setMatches([])
    setCurrentMatch(0)
    view.focus()
  }, [matches, findText, replaceText])

  // Keyboard shortcut: Cmd/Ctrl+H or Cmd/Ctrl+Shift+H opens find & replace
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'h') {
        e.preventDefault()
        setFindReplaceOpen((open) => !open)
        setTimeout(() => findInputRef.current?.focus(), 50)
      }
      if (e.key === 'Escape' && findReplaceOpen) {
        setFindReplaceOpen(false)
        viewRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [findReplaceOpen])

  // Toolbar Find button (dispatched as an event to avoid prop drilling).
  useEffect(() => {
    const handler = () => {
      setFindReplaceOpen((open) => !open)
      setTimeout(() => findInputRef.current?.focus(), 50)
    }
    window.addEventListener('konbini:toggle-find', handler)
    return () => window.removeEventListener('konbini:toggle-find', handler)
  }, [])

  // Sync focus mode into CM6 state field
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: focusModeEffect.of(focusMode) })
  }, [focusMode])

  // Sync typewriter mode into CM6 compartment
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: typewriterCompartment.current.reconfigure(typewriterMode ? makeTypewriterPlugin() : []),
    })
  }, [typewriterMode])

  // Sync render mode (live preview vs raw markdown) into CM6 compartment
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: livePreviewCompartment.current.reconfigure(livePreviewOn ? livePreview : []),
    })
  }, [livePreviewOn])

  return (
    <div style={{ height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }} onMouseUp={handleMouseUp} onMouseMove={handleMouseMove} onMouseLeave={() => setWikilinkTip(null)} onContextMenu={handleContextMenu} onClick={handleCommentClick}>
      {findReplaceOpen && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
          background: 'var(--bg-2)', borderBottom: '1px solid var(--border)',
          flexShrink: 0, flexWrap: 'wrap',
        }}>
          <input
            ref={findInputRef}
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') goNext() }}
            placeholder="Find"
            style={{
              padding: '3px 7px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
              background: 'var(--bg-2)', color: 'var(--text)',
              fontSize: 13, width: 160, outline: 'none',
            }}
          />
          <input
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doReplace() }}
            placeholder="Replace with"
            style={{
              padding: '3px 7px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
              background: 'var(--bg-2)', color: 'var(--text)',
              fontSize: 13, width: 160, outline: 'none',
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-3)', minWidth: 60 }}>
            {matches.length === 0 ? (findText ? '0 matches' : '') : `${currentMatch + 1} of ${matches.length}`}
          </span>
          {([['prev', 'chevron-left'], ['next', 'chevron-right']] as const).map(([kind, icon], i) => (
            <button
              key={kind}
              onClick={i === 0 ? goPrev : goNext}
              disabled={matches.length === 0}
              aria-label={i === 0 ? 'Previous match' : 'Next match'}
              title={i === 0 ? 'Previous match' : 'Next match'}
              style={{
                padding: '3px 8px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
                background: 'var(--bg-2)', color: 'var(--text)', display: 'inline-flex', alignItems: 'center',
                cursor: matches.length === 0 ? 'not-allowed' : 'pointer', fontSize: 13,
                opacity: matches.length === 0 ? 0.5 : 1,
              }}
            ><Icon name={icon} size={13} /></button>
          ))}
          <button
            onClick={doReplace}
            disabled={matches.length === 0}
            style={{
              padding: '3px 8px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
              background: 'var(--bg-2)', color: 'var(--text)',
              cursor: matches.length === 0 ? 'not-allowed' : 'pointer', fontSize: 13,
              opacity: matches.length === 0 ? 0.5 : 1,
            }}
          >Replace</button>
          <button
            onClick={doReplaceAll}
            disabled={matches.length === 0}
            style={{
              padding: '3px 8px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
              background: 'var(--bg-2)', color: 'var(--text)',
              cursor: matches.length === 0 ? 'not-allowed' : 'pointer', fontSize: 13,
              opacity: matches.length === 0 ? 0.5 : 1,
            }}
          >Replace All</button>
          <button
            onClick={() => { setFindReplaceOpen(false); viewRef.current?.focus() }}
            style={{
              marginLeft: 'auto', padding: '3px 8px', borderRadius: 'var(--r-sm)',
              border: '1px solid var(--border)',
              background: 'var(--bg-2)', color: 'var(--text)',
              cursor: 'pointer', fontSize: 13,
              display: 'inline-flex', alignItems: 'center',
            }}
            aria-label="Close find bar"
          ><Icon name="x" size={14} /></button>
        </div>
      )}
      {readAloudOpen && <ReadAloudBar onClose={() => { readAloud.stop(); setReadAloudOpen(false) }} />}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
      {wikilinkTip && (
        <div style={{
          position: 'fixed', left: wikilinkTip.x + 12, top: wikilinkTip.y + 12,
          background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
          padding: '10px 12px', maxWidth: 280, zIndex: 9000, pointerEvents: 'none',
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)', fontSize: 13, lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--accent)' }}>{wikilinkTip.title}</div>
          {wikilinkTip.synopsis && <div style={{ color: 'var(--text-2)', marginBottom: 4, fontStyle: 'italic' }}>{wikilinkTip.synopsis}</div>}
          {wikilinkTip.preview && <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{wikilinkTip.preview}{wikilinkTip.preview.length >= 200 ? '…' : ''}</div>}
        </div>
      )}
      {cowrite && (
        <CowriteBar
          docId={docId}
          selection={cowrite.selection}
          selRange={cowrite.selRange}
          anchorRect={cowrite.anchorRect}
          autoRun={cowrite.autoRun}
          onClose={() => setCowrite(null)}
        />
      )}
      {beat && (
        <BeatBox
          docId={docId}
          preceding={beat.preceding}
          anchorRect={beat.anchorRect}
          onClose={() => setBeat(null)}
          onInsert={insertBeat}
        />
      )}
      {editorMenu && (
        <ContextMenu
          x={editorMenu.x}
          y={editorMenu.y}
          items={editorMenuItems(editorMenu.hasSelection, editorMenu.slip)}
          onClose={() => setEditorMenu(null)}
        />
      )}
    </div>
  )
}
