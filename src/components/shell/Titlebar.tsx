import React from 'react'
import { useShellStore } from '../../store/shellStore'
import { useProjectStore } from '../../store/projectStore'
import WindowControls from './WindowControls'

export default function Titlebar(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const saveStatus = useProjectStore((s) => s.saveStatus)
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
    <div className="titlebar">
      <div className="proj">
        <span className="wm">KONBINI</span>
        {project && <b>{project.title}</b>}
      </div>
      <span style={{ flex: 1 }} />
      <div className={`save-pill${saveStatus === 'saving' ? ' saving' : ''}`}>
        {saveStatus === 'saving' && <><span className="save-dot" />Saving…</>}
        {saveStatus === 'saved' && <><span className="save-dot" />Saved</>}
      </div>
      <button className="tb-btn" title="Close project — back to projects" onClick={handleClose} style={{ marginLeft: 6 }}>
        ✕ Close project
      </button>
      <WindowControls />
    </div>
  )
}
