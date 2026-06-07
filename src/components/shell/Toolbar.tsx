import React from 'react'
import { useShellStore } from '../../store/shellStore'
import { useProjectStore } from '../../store/projectStore'

export default function Toolbar(): React.ReactElement {
  const layout = useShellStore((s) => s.layout)
  const toggleBinder = useShellStore((s) => s.toggleBinder)
  const toggleInsp = useShellStore((s) => s.toggleInsp)
  const setModal = useShellStore((s) => s.setModal)

  const view = useProjectStore((s) => s.view)
  const setView = useProjectStore((s) => s.setView)
  const setCompositionMode = useProjectStore((s) => s.setCompositionMode)
  const setFocusMode = useProjectStore((s) => s.setFocusMode)
  const focusMode = useProjectStore((s) => s.focusMode)
  const selectedId = useProjectStore((s) => s.selectedId)
  const project = useProjectStore((s) => s.project)
  const setScreen = useShellStore((s) => s.setScreen)

  const selectedNode = selectedId && project ? project.nodes[selectedId] : null

  return (
    <div className="toolbar">
      <div className="tb-group">
        <button
          className={`tb-btn${layout.binder ? ' on' : ''}`}
          title="Toggle Binder (⌘⌥B)"
          onClick={toggleBinder}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <rect x="2" y="2" width="4" height="12" rx="1" />
            <rect x="8" y="2" width="6" height="12" rx="1" />
          </svg>
        </button>
      </div>

      <div className="tb-sep" />

      {/* View segmented control */}
      <div className="seg">
        <button className={view === 'editor'    ? 'on' : ''} onClick={() => setView('editor')}    title="Editor (⌘1)">Editor</button>
        <button className={view === 'corkboard' ? 'on' : ''} onClick={() => setView('corkboard')} title="Corkboard (⌘2)">Corkboard</button>
        <button className={view === 'outliner'  ? 'on' : ''} onClick={() => setView('outliner')}  title="Outliner (⌘3)">Outliner</button>
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        <button
          className={`tb-btn${focusMode ? ' on' : ''}`}
          title="Focus Mode (⌘⌥O)"
          onClick={() => setFocusMode(!focusMode)}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <circle cx="8" cy="8" r="2.5" />
            <path d="M2 8h1.5M12.5 8H14M8 2v1.5M8 12.5V14" />
          </svg>
        </button>
        <button
          className="tb-btn"
          title="Composition Mode (⌘⌥C)"
          onClick={() => setCompositionMode(true)}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M2 2h12v12H2z" /><path d="M5 5h6M5 8h6M5 11h3" />
          </svg>
        </button>
      </div>

      <div className="tb-spacer" />

      <div className="tb-group">
        <button className="tb-btn" title="Take Snapshot (⌘⇧S)" onClick={() => setModal('snapshot')}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M8 3v6M5 6l3 3 3-3" />
            <path d="M3 11h10" />
          </svg>
          Snapshot
        </button>
        <button className="tb-btn" title="Compile (⌘⇧E)" onClick={() => setModal('compile')}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M4 2h8v12H4z" /><path d="M6 5h4M6 8h4M6 11h2" />
          </svg>
          Compile
        </button>
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        <button
          className={`tb-btn${layout.insp ? ' on' : ''}`}
          title="Toggle Inspector (⌘⌥I)"
          onClick={toggleInsp}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <rect x="10" y="2" width="4" height="12" rx="1" />
            <rect x="2" y="2" width="6" height="12" rx="1" />
          </svg>
        </button>
      </div>

      <div className="tb-sep" />

      {/* AI opt-in (Phase 2 — shows as disabled spark for now) */}
      <button className="tb-btn ai-enable" title="Enable AI layer (Phase 2)" disabled>
        <span className="ai-spark">✦</span> AI
      </button>
    </div>
  )
}
