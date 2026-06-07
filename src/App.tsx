import React, { useEffect, useCallback } from 'react'
import { useShellStore } from './store/shellStore'
import { useProjectStore } from './store/projectStore'
import Launch from './components/launch/Launch'
import Studio from './components/Studio'
import type { NodeType } from './shared/types'

export default function App(): React.ReactElement {
  const screen = useShellStore((s) => s.screen)
  const theme = useShellStore((s) => s.theme)
  const setModal = useShellStore((s) => s.setModal)
  const setRecents = useShellStore((s) => s.setRecents)
  const toggleBinder = useShellStore((s) => s.toggleBinder)
  const toggleInsp = useShellStore((s) => s.toggleInsp)
  const setTheme = useShellStore((s) => s.setTheme)
  const setView = useProjectStore((s) => s.setView)
  const setCompositionMode = useProjectStore((s) => s.setCompositionMode)
  const setFocusMode = useProjectStore((s) => s.setFocusMode)
  const unloadProject = useProjectStore((s) => s.unloadProject)
  const applyMutation = useProjectStore((s) => s.applyMutation)
  const undoMutation = useProjectStore((s) => s.undoMutation)
  const selectNode = useProjectStore((s) => s.selectNode)
  const setRenamingId = useProjectStore((s) => s.setRenamingId)
  const project = useProjectStore((s) => s.project)
  const setScreen = useShellStore((s) => s.setScreen)

  const createNode = useCallback(async (nodeType: NodeType) => {
    if (!project) return
    const selectedId = useProjectStore.getState().selectedId
    const parentId = selectedId && project.nodes[selectedId]?.type === 'folder' ? selectedId : null
    const result = await window.api.node.mutate(project.id, { type: 'create', parentId, nodeType })
    applyMutation(result)
    const newId = Object.values(result.nodes).find((n) => n.ext['_newId'])?.id
    if (newId) { selectNode(newId); setRenamingId(newId) }
  }, [project, applyMutation, selectNode, setRenamingId])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    window.api.project.recents().then(setRecents).catch(console.error)
  }, [])

  const handleKey = useCallback((e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    const shift = e.shiftKey
    const alt = e.altKey
    if (!mod) return

    // Structural undo (node ops) — only when editor is NOT focused (CM6 handles its own undo)
    if (!shift && !alt && e.key === 'z') {
      const tag = (document.activeElement as HTMLElement)?.tagName
      const isCM = document.activeElement?.closest('.cm-editor')
      if (!isCM && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        if (undoMutation()) e.preventDefault()
      }
    }

    // Navigation & layout
    if (alt && e.key === 'b') { e.preventDefault(); toggleBinder() }
    if (alt && e.key === 'i') { e.preventDefault(); toggleInsp() }
    if (alt && e.key === 't') { e.preventDefault(); setTheme(theme === 'dark' ? 'light' : 'dark') }
    if (alt && e.key === 'c') { e.preventDefault(); setCompositionMode(true) }
    if (alt && e.key === 'o') { e.preventDefault(); setFocusMode(!useProjectStore.getState().focusMode) }

    // Views
    if (!shift && !alt && e.key === '1') { e.preventDefault(); setView('editor') }
    if (!shift && !alt && e.key === '2') { e.preventDefault(); setView('corkboard') }
    if (!shift && !alt && e.key === '3') { e.preventDefault(); setView('outliner') }

    // Modals
    if (shift && e.key === 'S') { e.preventDefault(); setModal('snapshot') }
    if (shift && e.key === 'E') { e.preventDefault(); setModal('compile') }
    if (e.key === '/') { e.preventDefault(); setModal('shortcuts') }
    if (!shift && !alt && e.key === ',') { e.preventDefault(); setModal('prefs') }
    if (shift && e.key === 'F') { e.preventDefault(); setModal('search') }
    if (shift && e.key === 'K') { e.preventDefault(); setModal('codex') }
    if (shift && e.key === 'A') { e.preventDefault(); setModal('ai-settings') }
    if (shift && e.key === 'R') { e.preventDefault(); setModal('reader') }
    if (shift && e.key === 'G') { e.preventDefault(); setModal('batch-generator') }

    // New project / open (always available)
    if (!shift && !alt && e.key === 'n' && screen === 'launch') { e.preventDefault(); setModal('new-project') }
    if (!shift && !alt && e.key === 'o') {
      e.preventDefault()
      window.api.project.showOpenDialog().then(async (path) => {
        if (!path) return
        const p = await window.api.project.open(path)
        useProjectStore.getState().loadProject(p)
        setScreen('studio')
        const recents = await window.api.project.recents()
        setRecents(recents)
      }).catch((e: Error) => alert('Could not open project: ' + e.message))
    }

    // Node creation (studio only)
    if (screen === 'studio') {
      if (!shift && alt && e.key === 'n') { e.preventDefault(); createNode('folder') }
      if (shift && e.key === 'D') { e.preventDefault(); createNode('document') }
      if (shift && e.key === 'N') { e.preventDefault(); createNode('scene') }
    }

    // Close project
    if (!shift && !alt && e.key === 'w' && project) {
      e.preventDefault()
      window.api.project.close(project.id).catch(console.error)
      unloadProject()
      setScreen('launch')
      window.api.project.recents().then(setRecents).catch(console.error)
    }
  }, [theme, project, screen, createNode, undoMutation])

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  return screen === 'launch' ? <Launch /> : <Studio />
}
