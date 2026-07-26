import React from 'react'
import { useShellStore } from '../../store/shellStore'
import { useProjectStore } from '../../store/projectStore'
import WindowControls from './WindowControls'
import Icon from '../common/Icon'

export default function Titlebar(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const setScreen = useShellStore((s) => s.setScreen)
  const unloadProject = useProjectStore((s) => s.unloadProject)
  const setRecents = useShellStore((s) => s.setRecents)

  const handleClose = async () => {
    if (project) await window.api.project.close(project.id).catch(console.error)
    unloadProject()
    window.api.project.recents().then(setRecents).catch(console.error)
    setScreen('launch')
  }

  return (
    <header className="titlebar">
      <div className="proj">
        <span className="wm">KONBINI</span>
        {/* The project title is the page's one h1: a screen reader landing here
            should hear what document set it is inside, not "banner, button". */}
        {project && <h1>{project.title}</h1>}
      </div>
      <span style={{ flex: 1 }} />
      <button className="tb-btn" title="Close project — back to projects" onClick={handleClose} style={{ marginLeft: 6, gap: 6 }}>
        <Icon name="x" size={13} /> Close project
      </button>
      <WindowControls />
    </header>
  )
}
