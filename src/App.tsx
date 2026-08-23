import React, { useEffect, useCallback } from 'react'
import { useShellStore } from './store/shellStore'
import { useProjectStore } from './store/projectStore'
import { useAIStore } from './store/aiStore'
import Launch from './components/launch/Launch'
import Studio from './components/Studio'
import Toast from './components/common/Toast'
import ErrorBoundary from './components/common/ErrorBoundary'
import type { NodeType } from './shared/types'

export default function App(): React.ReactElement {
  const screen = useShellStore((s) => s.screen)
  const theme = useShellStore((s) => s.theme)
  const setModal = useShellStore((s) => s.setModal)
  const setToast = useShellStore((s) => s.setToast)
  const setRecents = useShellStore((s) => s.setRecents)
  const toggleBinder = useShellStore((s) => s.toggleBinder)
  const toggleRailPanel = useShellStore((s) => s.toggleRailPanel)
  const setTheme = useShellStore((s) => s.setTheme)
  const setView = useProjectStore((s) => s.setView)
  const toggleSplit = useProjectStore((s) => s.toggleSplit)
  const setCompositionMode = useProjectStore((s) => s.setCompositionMode)
  const setFocusMode = useProjectStore((s) => s.setFocusMode)
  const unloadProject = useProjectStore((s) => s.unloadProject)
  const applyMutation = useProjectStore((s) => s.applyMutation)
  const undoMutation = useProjectStore((s) => s.undoMutation)
  const redoMutation = useProjectStore((s) => s.redoMutation)
  const selectNode = useProjectStore((s) => s.selectNode)
  const setRenamingId = useProjectStore((s) => s.setRenamingId)
  const project = useProjectStore((s) => s.project)
  const setScreen = useShellStore((s) => s.setScreen)

  const createNode = useCallback(async (nodeType: NodeType) => {
    if (!project) return
    const selectedId = useProjectStore.getState().selectedId
    const parentId = selectedId && project.nodes[selectedId]?.type === 'folder' ? selectedId : null
    try {
      const result = await window.api.node.mutate(project.id, { type: 'create', parentId, nodeType })
      applyMutation(result)
      const newId = Object.values(result.nodes).find((n) => n.ext['_newId'])?.id
      if (newId) { selectNode(newId); setRenamingId(newId) }
    } catch (e) {
      useShellStore.getState().setToast('Could not create: ' + (e as Error).message)
    }
  }, [project, applyMutation, selectNode, setRenamingId])

  // ⌘D — duplicate the selection. Acts on the whole multi-selection, like every
  // other node action, via `actionTargets`.
  const duplicateSelection = useCallback(async () => {
    const store = useProjectStore.getState()
    const p = store.project
    const selectedId = store.selectedId
    if (!p || !selectedId) return
    try {
      for (const id of store.actionTargets(selectedId)) {
        applyMutation(await window.api.node.mutate(p.id, { type: 'duplicate', id }))
      }
    } catch (e) {
      useShellStore.getState().setToast('Could not duplicate: ' + (e as Error).message)
    }
  }, [applyMutation])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    window.api.project.recents().then(setRecents).catch(console.error)
  }, [])

  useEffect(() => {
    const handler = () => setToast('Preferences could not be saved (storage full?)')
    window.addEventListener('konbini:prefs-error', handler)
    return () => window.removeEventListener('konbini:prefs-error', handler)
  }, [setToast])

  const handleKey = useCallback((e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    const shift = e.shiftKey
    const alt = e.altKey

    // Escape closes the open modal. Generative modals (which hold expensive,
    // unsaved AI output — a close aborts the in-flight run) and the
    // palette/search (own their Escape) are excluded so a stray Escape can't
    // silently discard work.
    if (e.key === 'Escape') {
      const open = useShellStore.getState().modal
      const guarded = ['foundation', 'bestof', 'batch-generator', 'autopilot', 'command-palette', 'search']
      if (open && !guarded.includes(open)) {
        e.preventDefault()
        setModal(null)
      }
      return
    }

    if (!mod) return

    // Compare against a lower-cased key throughout. `e.key` carries the shift
    // and Caps Lock state, so `e.key === 'E'` misses when Caps Lock is on and
    // `e.key === 'z'` never matches at all while Shift is held — which is why
    // Redo (mod+shift+z) has been listed in the palette but doing nothing.
    const key = e.key.toLowerCase()

    // Structural undo/redo (node ops) — only when editor is NOT focused (CM6
    // handles its own text undo/redo).
    const tag = (document.activeElement as HTMLElement)?.tagName
    const inField = !!document.activeElement?.closest('.cm-editor') || tag === 'INPUT' || tag === 'TEXTAREA'
    if (!inField && !alt && key === 'z') {
      if (shift ? redoMutation() : undoMutation()) e.preventDefault()
    }
    if (!inField && !alt && key === 'y') {
      if (redoMutation()) e.preventDefault()
    }

    // Navigation & layout
    if (alt && key === 'b') { e.preventDefault(); toggleBinder() }
    // Put the caret in the binder. Without this the tree is 20 Tab presses
    // deep, which makes its keyboard navigation theoretical.
    if (shift && !alt && key === 'b') {
      e.preventDefault()
      if (!useShellStore.getState().layout.binder) toggleBinder()
      window.dispatchEvent(new Event('konbini:focus-binder'))
    }
    if (alt && key === 'i') { e.preventDefault(); toggleRailPanel('inspector') }
    if (alt && key === 't') { e.preventDefault(); setTheme(theme === 'dark' ? 'light' : 'dark') }
    if (alt && key === 'c') { e.preventDefault(); setCompositionMode(true) }
    if (alt && key === 'o') { e.preventDefault(); setFocusMode(!useProjectStore.getState().focusMode) }

    // Split editor
    if (!shift && !alt && e.key === '\\') { e.preventDefault(); toggleSplit() }

    // Views
    if (!shift && !alt && e.key === '1') { e.preventDefault(); setView('editor') }
    if (!shift && !alt && e.key === '2') { e.preventDefault(); setView('corkboard') }
    if (!shift && !alt && e.key === '3') { e.preventDefault(); setView('outliner') }
    if (!shift && !alt && e.key === '4') { e.preventDefault(); setView('timeline') }

    // Modals
    if (!shift && !alt && key === 'k') { e.preventDefault(); setModal('command-palette') }
    if (shift && key === 's') { e.preventDefault(); useShellStore.getState().setRailPanel('history') }
    if (shift && key === 'e') { e.preventDefault(); setModal('compile') }
    if (e.key === '/') { e.preventDefault(); setModal('shortcuts') }
    if (!shift && !alt && e.key === ',') { e.preventDefault(); useProjectStore.getState().openViewTab('prefs') }
    if (shift && key === 'f') { e.preventDefault(); setModal('search') }
    if (shift && key === 'k') { e.preventDefault(); if (useAIStore.getState().enabled) useShellStore.getState().toggleRailPanel('codex') }
    if (shift && key === 'a') {
      e.preventDefault()
      if (useAIStore.getState().enabled) useShellStore.getState().toggleRailPanel('assistant')
    }
    if (shift && key === 'r') { e.preventDefault(); if (useAIStore.getState().enabled) useShellStore.getState().toggleRailPanel('reader') }
    if (shift && key === 'g') { e.preventDefault(); useProjectStore.getState().openViewTab('batch-generator') }
    if (shift && key === 'p') { e.preventDefault(); useProjectStore.getState().openViewTab('autopilot') }

    // New project / open (always available)
    if (!shift && !alt && key === 'n' && screen === 'launch') { e.preventDefault(); setModal('new-project') }
    if (!shift && !alt && key === 'o') {
      e.preventDefault()
      window.api.project.showOpenDialog().then(async (path) => {
        if (!path) return
        const p = await window.api.project.open(path)
        useProjectStore.getState().loadProject(p)
        setScreen('studio')
        const recents = await window.api.project.recents()
        setRecents(recents)
      }).catch((e: Error) => setToast('Could not open project: ' + e.message))
    }

    // Node creation (studio only)
    if (screen === 'studio') {
      if (!shift && alt && key === 'n') { e.preventDefault(); createNode('folder') }
      if (shift && key === 'd') { e.preventDefault(); createNode('document') }
      if (shift && key === 'n') { e.preventDefault(); createNode('scene') }
      if (!shift && !alt && key === 'd') { e.preventDefault(); void duplicateSelection() }
    }

    // Close project
    if (!shift && !alt && key === 'w' && project) {
      e.preventDefault()
      window.api.project.close(project.id).catch(console.error)
      unloadProject()
      setScreen('launch')
      window.api.project.recents().then(setRecents).catch(console.error)
    }
  }, [theme, project, screen, setToast, createNode, duplicateSelection, undoMutation, redoMutation, toggleSplit])

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  return (
    <ErrorBoundary>
      {screen === 'launch' ? <Launch /> : <Studio />}
      <Toast />
    </ErrorBoundary>
  )
}
