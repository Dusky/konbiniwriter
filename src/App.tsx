import React, { useEffect, useCallback } from 'react'
import { useShellStore } from './store/shellStore'
import { useProjectStore } from './store/projectStore'
import Launch from './components/launch/Launch'
import Studio from './components/Studio'

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
  const project = useProjectStore((s) => s.project)
  const setScreen = useShellStore((s) => s.setScreen)

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

    if (alt && e.key === 'b') { e.preventDefault(); toggleBinder() }
    if (alt && e.key === 'i') { e.preventDefault(); toggleInsp() }
    if (alt && e.key === 't') { e.preventDefault(); setTheme(theme === 'dark' ? 'light' : 'dark') }
    if (alt && e.key === 'c') { e.preventDefault(); setCompositionMode(true) }
    if (alt && e.key === 'o') { e.preventDefault(); setFocusMode(!useProjectStore.getState().focusMode) }
    if (!shift && !alt && e.key === '1') { e.preventDefault(); setView('editor') }
    if (!shift && !alt && e.key === '2') { e.preventDefault(); setView('corkboard') }
    if (!shift && !alt && e.key === '3') { e.preventDefault(); setView('outliner') }
    if (shift && e.key === 'S') { e.preventDefault(); setModal('snapshot') }
    if (shift && e.key === 'E') { e.preventDefault(); setModal('compile') }
    if (e.key === '/') { e.preventDefault(); setModal('shortcuts') }
    if (shift && e.key === 'W' && project) {
      e.preventDefault()
      window.api.project.close(project.id).catch(console.error)
      unloadProject()
      setScreen('launch')
      window.api.project.recents().then(setRecents).catch(console.error)
    }
  }, [theme, project, screen])

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  return screen === 'launch' ? <Launch /> : <Studio />
}
