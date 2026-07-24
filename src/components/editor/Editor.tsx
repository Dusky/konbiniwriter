import React, { useEffect, useRef, useCallback, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { focusModeEffect, konbiniExtensions, makeTypewriterPlugin, setSlopSpansEffect, type SlopSpan } from './extensions'
import { useProjectStore } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
import { useAutosave } from '../../hooks/useAutosave'
import { useAIStore } from '../../store/aiStore'
import CowriteBar from './CowriteBar'
import ContextMenu, { type MenuItem } from '../common/ContextMenu'
import Icon from '../common/Icon'
import { COWRITE_COMMANDS, type CowriteCommand } from '../../lib/cowrite'
import { promptRegistry } from '../../lib/PromptRegistry'
import { streamCompletion } from '../../lib/AIClient'

// Editor right-click behaviour. 'selection' shows the custom menu only when
// text is selected (so the browser's native menu — with spellcheck — still
// appears otherwise). Flip to 'always' to show the custom menu on every
// right-click.
const EDITOR_MENU_MODE: 'selection' | 'always' = 'selection'

interface Props {
  docId: string
}

export default function Editor({ docId }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const typewriterCompartment = useRef(new Compartment())

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
  const setModal = useShellStore((s) => s.setModal)

  const content = project?.docs[docId]?.content ?? ''

  const [cowrite, setCowrite] = useState<{ selection: string; selRange: { from: number; to: number }; anchorRect: DOMRect; autoRun?: CowriteCommand } | null>(null)
  const [editorMenu, setEditorMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null)
  const [wikilinkTip, setWikilinkTip] = useState<{ title: string; synopsis: string; preview: string; x: number; y: number } | null>(null)

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

  const editorMenuItems = useCallback((hasSelection: boolean): MenuItem[] => {
    const items: MenuItem[] = []
    if (hasSelection) {
      items.push({ label: 'Cut', action: doCut }, { label: 'Copy', action: doCopy })
    }
    items.push({ label: 'Paste', action: () => { void doPaste() } })
    if (!hasSelection) items.push({ label: 'Select All', action: doSelectAll })
    if (aiEnabled && hasSelection) {
      items.push({ label: '---', action: () => {} })
      for (const c of COWRITE_COMMANDS) items.push({ label: c.label, action: () => startCowrite(c.id) })
    }
    items.push({ label: '---', action: () => {} })
    items.push({ label: 'Take Snapshot', action: () => setModal('history') })
    items.push({ label: 'Document History', action: () => setModal('history') })
    return items
  }, [aiEnabled, doCut, doCopy, doPaste, doSelectAll, startCowrite, setModal])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const view = viewRef.current
    if (!view) return
    const sel = view.state.selection.main
    const hasSelection = sel.from !== sel.to
    // In 'selection' mode, fall through to the browser's native menu (which
    // carries spellcheck suggestions) when nothing is selected.
    if (EDITOR_MENU_MODE === 'selection' && !hasSelection) return
    e.preventDefault()
    setEditorMenu({ x: e.clientX, y: e.clientY, hasSelection })
  }, [])

  // Mount / remount when docId changes
  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: content,
      extensions: [
        ...konbiniExtensions(handleChange, handleCursor),
        typewriterCompartment.current.of(typewriterMode ? makeTypewriterPlugin() : []),
      ],
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view

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

  return (
    <div style={{ height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }} onMouseUp={handleMouseUp} onMouseMove={handleMouseMove} onMouseLeave={() => setWikilinkTip(null)} onContextMenu={handleContextMenu}>
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
          {(['◀', '▶'] as const).map((label, i) => (
            <button
              key={label}
              onClick={i === 0 ? goPrev : goNext}
              disabled={matches.length === 0}
              style={{
                padding: '3px 8px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
                background: 'var(--bg-2)', color: 'var(--text)',
                cursor: matches.length === 0 ? 'not-allowed' : 'pointer', fontSize: 13,
                opacity: matches.length === 0 ? 0.5 : 1,
              }}
            >{label}</button>
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
      {editorMenu && (
        <ContextMenu
          x={editorMenu.x}
          y={editorMenu.y}
          items={editorMenuItems(editorMenu.hasSelection)}
          onClose={() => setEditorMenu(null)}
        />
      )}
    </div>
  )
}
