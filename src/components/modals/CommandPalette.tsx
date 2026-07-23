import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useShellStore } from '../../store/shellStore'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import type { ModalId, NodeType } from '@shared/types'

interface Command {
  id: string
  label: string
  section: string
  hint?: string
  run: () => void
}

// Lightweight subsequence fuzzy match — every query char appears in order.
function fuzzy(query: string, text: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

interface Props { onClose: () => void }

export default function CommandPalette({ onClose }: Props): React.ReactElement {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const aiEnabled = useAIStore((s) => s.enabled)

  useEffect(() => { inputRef.current?.focus() }, [])

  const project = useProjectStore((s) => s.project)

  const commands = useMemo<Command[]>(() => {
    const shell = useShellStore.getState()
    const proj = useProjectStore.getState()
    const openModal = (m: ModalId) => () => shell.setModal(m)

    // Launch screen (no project loaded): a small set focused on getting in.
    if (!project) {
      const finishOpen = (p: Parameters<typeof proj.loadProject>[0]) => { proj.loadProject(p); shell.setScreen('studio') }
      const launch: Command[] = [
        { id: 'new-project', label: 'New Project…', section: 'Start', run: () => shell.setModal('new-project') },
        {
          id: 'open-project', label: 'Open Project…', section: 'Start',
          run: async () => {
            const key = await window.api.project.showOpenDialog()
            if (key) finishOpen(await window.api.project.open(key))
          },
        },
        ...shell.recents.slice(0, 8).map((r) => ({
          id: `recent-${r.id}`, label: r.title, section: 'Recent',
          run: async () => {
            try { finishOpen(await window.api.project.openRecent(r.id, r.location)) }
            catch {
              const key = await window.api.project.showOpenDialog()
              if (key) finishOpen(await window.api.project.open(key))
            }
          },
        })),
        { id: 'theme', label: `Theme: switch to ${shell.theme === 'dark' ? 'Light' : 'Dark'}`, section: 'View', run: () => shell.setTheme(useShellStore.getState().theme === 'dark' ? 'light' : 'dark') },
        { id: 'shortcuts', label: 'Keyboard Shortcuts…', section: 'Help', run: openModal('shortcuts') },
        { id: 'about', label: 'About Konbini…', section: 'Help', run: openModal('about') },
      ]
      return launch
    }

    const createNode = async (nodeType: NodeType) => {
      const p = proj.project
      if (!p) return
      const selectedId = useProjectStore.getState().selectedId
      const parentId = selectedId && p.nodes[selectedId]?.type === 'folder' ? selectedId : null
      const result = await window.api.node.mutate(p.id, { type: 'create', parentId, nodeType })
      proj.applyMutation(result)
      const newId = Object.values(result.nodes).find((n) => n.ext['_newId'])?.id
      if (newId) { proj.selectNode(newId); proj.setRenamingId(newId) }
    }

    const cmds: Command[] = [
      // Edit
      { id: 'undo', label: 'Undo Tree Change', section: 'Edit', hint: '⌘Z', run: () => proj.undoMutation() },
      { id: 'redo', label: 'Redo Tree Change', section: 'Edit', hint: '⌘⇧Z', run: () => proj.redoMutation() },
      // Views
      { id: 'view-editor', label: 'View: Editor', section: 'View', hint: '⌘1', run: () => proj.setView('editor') },
      { id: 'view-corkboard', label: 'View: Corkboard', section: 'View', hint: '⌘2', run: () => proj.setView('corkboard') },
      { id: 'view-outliner', label: 'View: Outliner', section: 'View', hint: '⌘3', run: () => proj.setView('outliner') },
      { id: 'view-timeline', label: 'View: Timeline', section: 'View', hint: '⌘4', run: () => proj.setView('timeline') },
      // Layout / modes
      { id: 'toggle-binder', label: 'Toggle Binder', section: 'Layout', hint: '⌘⌥B', run: () => shell.toggleBinder() },
      { id: 'toggle-insp', label: 'Toggle Inspector', section: 'Layout', hint: '⌘⌥I', run: () => shell.toggleRailPanel('inspector') },
      { id: 'split', label: 'Toggle Split Editor', section: 'Layout', hint: '⌘\\', run: () => proj.toggleSplit() },
      { id: 'focus', label: `Focus Mode: ${proj.focusMode ? 'Off' : 'On'}`, section: 'Layout', hint: '⌘⌥O', run: () => proj.setFocusMode(!useProjectStore.getState().focusMode) },
      { id: 'composition', label: 'Composition Mode', section: 'Layout', hint: '⌘⌥C', run: () => proj.setCompositionMode(true) },
      { id: 'typewriter', label: `Typewriter Scroll: ${shell.typewriterMode ? 'Off' : 'On'}`, section: 'Layout', run: () => shell.setTypewriterMode(!useShellStore.getState().typewriterMode) },
      { id: 'theme', label: `Theme: switch to ${shell.theme === 'dark' ? 'Light' : 'Dark'}`, section: 'Layout', hint: '⌘⌥T', run: () => shell.setTheme(useShellStore.getState().theme === 'dark' ? 'light' : 'dark') },
      // Create
      { id: 'new-doc', label: 'New Document', section: 'Create', hint: '⌘⇧D', run: () => createNode('document') },
      { id: 'new-scene', label: 'New Scene', section: 'Create', hint: '⌘⇧N', run: () => createNode('scene') },
      { id: 'new-folder', label: 'New Folder', section: 'Create', hint: '⌘⌥N', run: () => createNode('folder') },
      // Project tools
      { id: 'history', label: 'Document History…', section: 'Document', run: openModal('history') },
      { id: 'snapshot', label: 'Take Snapshot…', section: 'Document', hint: '⌘⇧S', run: openModal('history') },
      { id: 'search', label: 'Search Project…', section: 'Project', hint: '⌘⇧F', run: openModal('search') },
      { id: 'compile', label: 'Compile / Export…', section: 'Project', hint: '⌘⇧E', run: openModal('compile') },
      { id: 'stats', label: 'Writing Stats…', section: 'Project', run: openModal('stats') },
      { id: 'prefs', label: 'Preferences…', section: 'Project', hint: '⌘,', run: openModal('prefs') },
    ]

    if (aiEnabled) {
      cmds.push(
        { id: 'ai-codex', label: 'Codex…', section: 'AI', hint: '⌘⇧K', run: () => shell.setRailPanel('codex') },
        { id: 'ai-debt', label: 'Propagation Debt…', section: 'AI', run: openModal('debt') },
        { id: 'ai-chat', label: 'AI Chat…', section: 'AI', hint: '⌘⇧A', run: () => shell.setRailPanel('assistant') },
        { id: 'ai-reader', label: 'Reader Panel…', section: 'AI', hint: '⌘⇧R', run: () => shell.setRailPanel('reader') },
        { id: 'ai-foundation', label: 'Foundation (seed → world → cast)…', section: 'AI', run: openModal('foundation') },
        { id: 'ai-batch', label: 'Batch Generators…', section: 'AI', hint: '⌘⇧G', run: openModal('batch-generator') },
        { id: 'ai-bestof', label: 'Best of N (variant tournament)…', section: 'AI', run: openModal('bestof') },
        { id: 'ai-critic', label: 'Critic (professor critique + revision)…', section: 'AI', run: () => shell.setRailPanel('critic') },
        { id: 'ai-autopilot', label: 'Autopilot…', section: 'AI', hint: '⌘⇧P', run: openModal('autopilot') },
        { id: 'ai-prompts', label: 'Prompt Registry…', section: 'AI', run: openModal('prompt-registry') },
        { id: 'ai-settings', label: 'AI Settings…', section: 'AI', run: openModal('ai-settings') },
      )
    } else {
      cmds.push({ id: 'ai-enable', label: 'Enable AI…', section: 'AI', run: openModal('ai-settings') })
    }

    cmds.push(
      { id: 'shortcuts', label: 'Keyboard Shortcuts…', section: 'Help', hint: '⌘/', run: openModal('shortcuts') },
      { id: 'about', label: 'About Konbini…', section: 'Help', run: openModal('about') },
      {
        id: 'close-project', label: 'Close Project', section: 'Project', hint: '⌘W',
        run: () => {
          const p = useProjectStore.getState().project
          if (!p) return
          window.api.project.close(p.id).catch(console.error)
          useProjectStore.getState().unloadProject()
          useShellStore.getState().setScreen('launch')
          window.api.project.recents().then(useShellStore.getState().setRecents).catch(console.error)
        },
      },
    )
    return cmds
  }, [aiEnabled, project])

  const filtered = useMemo(
    () => commands.filter((c) => fuzzy(query.trim(), c.label) || fuzzy(query.trim(), c.section)),
    [commands, query]
  )

  useEffect(() => { setActive(0) }, [query])

  const runCommand = (c: Command) => { onClose(); c.run() }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    if (e.key === 'Enter') { e.preventDefault(); if (filtered[active]) runCommand(filtered[active]) }
  }

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-cmd="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-label="Command Palette">
        <div className="modal-hd" style={{ paddingBottom: 0 }}>
          <input
            ref={inputRef}
            placeholder="Type a command…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            style={{
              width: '100%', background: 'var(--bg-2)', border: '1px solid var(--border-2)',
              borderRadius: 'var(--r-md)', padding: '9px 12px', fontSize: 14, color: 'var(--text)', outline: 'none',
            }}
          />
        </div>
        <div ref={listRef} className="modal-body" style={{ maxHeight: 380, overflowY: 'auto', padding: '8px 0' }}>
          {filtered.length === 0 ? (
            <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: '32px 0', fontSize: 13 }}>
              No matching commands
            </div>
          ) : filtered.map((c, i) => (
            <button
              key={c.id}
              data-cmd={i}
              onClick={() => runCommand(c)}
              onMouseEnter={() => setActive(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                border: 'none', padding: '8px 20px', cursor: 'pointer',
                background: i === active ? 'var(--bg-2)' : 'transparent',
              }}
            >
              <span style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em', minWidth: 64 }}>
                {c.section}
              </span>
              <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>{c.label}</span>
              {c.hint && <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{c.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
