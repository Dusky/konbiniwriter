import React, { useState } from 'react'
import { useShellStore } from '../../store/shellStore'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import ContextMenu from '../common/ContextMenu'

export default function Toolbar(): React.ReactElement {
  const layout = useShellStore((s) => s.layout)
  const toggleBinder = useShellStore((s) => s.toggleBinder)
  const setModal = useShellStore((s) => s.setModal)
  const railPanel = useShellStore((s) => s.railPanel)
  const toggleRailPanel = useShellStore((s) => s.toggleRailPanel)
  const setRailPanel = useShellStore((s) => s.setRailPanel)
  const [aiMenu, setAiMenu] = useState<{ x: number; y: number } | null>(null)

  const view = useProjectStore((s) => s.view)
  const setView = useProjectStore((s) => s.setView)
  const setCompositionMode = useProjectStore((s) => s.setCompositionMode)
  const setFocusMode = useProjectStore((s) => s.setFocusMode)
  const focusMode = useProjectStore((s) => s.focusMode)
  const selectedId = useProjectStore((s) => s.selectedId)
  const project = useProjectStore((s) => s.project)
  const setScreen = useShellStore((s) => s.setScreen)
  const splitOpen = useProjectStore((s) => s.splitOpen)
  const toggleSplit = useProjectStore((s) => s.toggleSplit)

  const selectedNode = selectedId && project ? project.nodes[selectedId] : null
  const aiEnabled = useAIStore((s) => s.enabled)
  const slopRunning = useProjectStore((s) => s.slopRunning)
  const slopCount = useProjectStore((s) => s.slopSpans.length)
  const debtOpen = useProjectStore((s) => s.debt.filter((d) => d.affected.some((a) => !a.resolved)).length)

  return (
    <div className="toolbar">
      <div className="tb-group">
        <button
          className={`tb-btn${layout.binder ? ' on' : ''}`}
          title="Toggle Binder (⌘⌥B)"
          aria-label="Toggle Binder"
          aria-pressed={layout.binder}
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
        <button className={view === 'timeline'  ? 'on' : ''} onClick={() => setView('timeline')}  title="Timeline (⌘4)">≋ Timeline</button>
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        <button
          className={`tb-btn${splitOpen ? ' on' : ''}`}
          title="Split Editor (⌘\)"
          aria-label="Split Editor"
          aria-pressed={splitOpen}
          onClick={toggleSplit}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <rect x="1" y="2" width="6" height="12" rx="1" />
            <rect x="9" y="2" width="6" height="12" rx="1" />
          </svg>
        </button>
        <button
          className={`tb-btn${focusMode ? ' on' : ''}`}
          title="Focus Mode (⌘⌥O)"
          aria-label="Focus Mode"
          aria-pressed={focusMode}
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
          aria-label="Composition Mode"
          onClick={() => setCompositionMode(true)}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M2 2h12v12H2z" /><path d="M5 5h6M5 8h6M5 11h3" />
          </svg>
        </button>
      </div>

      <div className="tb-spacer" />

      <div className="tb-group">
        <button className="tb-btn" title="Take Snapshot (⌘⇧S)" onClick={() => setModal('history')}>
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
          className={`tb-btn${railPanel === 'inspector' ? ' on' : ''}`}
          title="Toggle Inspector (⌘⌥I)"
          aria-label="Toggle Inspector"
          aria-pressed={railPanel === 'inspector'}
          onClick={() => toggleRailPanel('inspector')}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <rect x="10" y="2" width="4" height="12" rx="1" />
            <rect x="2" y="2" width="6" height="12" rx="1" />
          </svg>
        </button>
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        <button className="tb-btn" title="Find & Replace (⌘H)" aria-label="Find and Replace" onClick={() => window.dispatchEvent(new CustomEvent('konbini:toggle-find'))}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <circle cx="6.5" cy="6.5" r="4" />
            <path d="M9.5 9.5L13 13" strokeLinecap="round" />
            <path d="M5 6.5h3M6.5 5v3" strokeLinecap="round" />
          </svg>
        </button>
        <button className="tb-btn" title="Search Project (⌘⇧F)" onClick={() => setModal('search')}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <circle cx="6.5" cy="6.5" r="4" />
            <path d="M9.5 9.5L13 13" strokeLinecap="round" />
          </svg>
        </button>
        <button className="tb-btn" title="Writing Stats" onClick={() => setModal('stats')}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M2 13V8M6 13V5M10 13V9M14 13V3" strokeLinecap="round" />
          </svg>
        </button>
        <button className="tb-btn" title="Preferences (⌘,)" onClick={() => setModal('prefs')}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <circle cx="8" cy="8" r="1.5" />
            <path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.5 3.5l1 1M11.5 11.5l1 1M3.5 12.5l1-1M11.5 4.5l1-1" />
          </svg>
        </button>
      </div>

      <div className="tb-sep" />

      {aiEnabled ? (
        <>
          <button
            className={`tb-btn${railPanel && railPanel !== 'inspector' ? ' on' : ''}`}
            title="AI tools"
            aria-haspopup="menu"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setAiMenu({ x: r.left, y: r.bottom + 4 })
            }}
          >
            <span className="ai-spark">✦</span> AI ▾
            {(debtOpen > 0 || slopCount > 0) && <span className="ai-dot" />}
          </button>
          <button className="tb-btn" title="AI Settings" onClick={() => setModal('ai-settings')} style={{ color: 'var(--accent)' }}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <circle cx="8" cy="8" r="1.5" />
              <path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.5 3.5l1 1M11.5 11.5l1 1M3.5 12.5l1-1M11.5 4.5l1-1" />
            </svg>
          </button>
          {aiMenu && (
            <ContextMenu
              x={aiMenu.x}
              y={aiMenu.y}
              onClose={() => setAiMenu(null)}
              items={[
                { label: 'Foundation', header: true },
                { label: 'Foundation — seed → world → cast', action: () => setModal('foundation') },
                { label: 'Codex', action: () => setRailPanel('codex') },
                { label: 'Prompt Registry', action: () => setModal('prompt-registry') },
                { label: 'Draft', header: true },
                { label: 'Chat', action: () => setRailPanel('assistant') },
                { label: 'Generate — cast, beats, chapter', action: () => setModal('batch-generator') },
                { label: slopRunning ? 'Slop Proof — running…' : slopCount > 0 ? `Slop Proof — ${slopCount} flagged` : 'Slop Proof', disabled: slopRunning, action: () => (window as unknown as Record<string, () => void>).__konbiniRunProof?.() },
                { label: 'Evaluate', header: true },
                { label: 'Reader Panel', action: () => setRailPanel('reader') },
                { label: 'Critic', action: () => setRailPanel('critic') },
                { label: 'Best of N', action: () => setModal('bestof') },
                { label: 'Revise', header: true },
                { label: 'Autopilot', action: () => setModal('autopilot') },
                { label: debtOpen > 0 ? `Propagation Debt — ${debtOpen}` : 'Propagation Debt', action: () => setModal('debt') },
              ]}
            />
          )}
        </>
      ) : (
        <button className="tb-btn ai-enable" title="Enable AI (⌘⇧A)" onClick={() => setModal('ai-settings')}>
          <span className="ai-spark">✦</span> AI
        </button>
      )}
    </div>
  )
}
