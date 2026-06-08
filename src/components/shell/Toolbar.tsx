import React from 'react'
import { useShellStore } from '../../store/shellStore'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'

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

      <div className="tb-group">
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
          <div className="tb-group">
            <button className="tb-btn" title="Codex (⌘⇧K)" onClick={() => setModal('codex')}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <path d="M3 2h8l2 2v10H3z" /><path d="M6 6h4M6 9h4M6 12h2" />
              </svg>
              Codex
            </button>
            <button className="tb-btn" title="Prompt Registry" onClick={() => setModal('prompt-registry')}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <path d="M2 4h12M2 8h8M2 12h10" strokeLinecap="round" />
              </svg>
            </button>
            <button className="tb-btn" title="Reader Panel — 4-persona critique" onClick={() => setModal('reader')}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <circle cx="5" cy="6" r="2.5" />
                <circle cx="11" cy="6" r="2.5" />
                <path d="M1 13c0-2 1.8-3.5 4-3.5M11 13c2.2 0 4 1.5 4 3.5M8 13c-1.5 0-2.5.8-2.5 2M8 13c1.5 0 2.5.8 2.5 2" strokeLinecap="round" />
              </svg>
              Readers
            </button>
            <button className="tb-btn" title="Best of N — generate variants, rank them, keep the winner" onClick={() => setModal('bestof')}>
              <span style={{ fontSize: 13 }}>🏆</span> Best of N
            </button>
            <button
              className={`tb-btn${slopCount > 0 ? ' on' : ''}`}
              title="Slop Proof — flag clichés and weak prose"
              disabled={slopRunning}
              onClick={() => (window as unknown as Record<string, () => void>).__konbiniRunProof?.()}
              style={{ position: 'relative' }}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <path d="M8 2l1.5 4h4l-3.2 2.4 1.2 4L8 10l-3.5 2.4 1.2-4L2.5 6h4z" />
              </svg>
              {slopRunning ? '…' : slopCount > 0 ? `${slopCount}` : 'Proof'}
            </button>
            <button
              className={`tb-btn${debtOpen > 0 ? ' on' : ''}`}
              title="Propagation Debt — scenes made stale by canon changes"
              onClick={() => setModal('debt')}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <path d="M8 1.5l6 11H2z" /><path d="M8 6.5v3" strokeLinecap="round" /><circle cx="8" cy="11.4" r="0.5" fill="currentColor" stroke="none" />
              </svg>
              {debtOpen > 0 ? `Debt ${debtOpen}` : 'Debt'}
            </button>
          </div>
          <div className="tb-sep" />
          <button className="tb-btn" title="Foundation — seed → concept → world → cast" onClick={() => setModal('foundation')}>
            <span style={{ fontSize: 13 }}>❖</span> Foundation
          </button>
          <button className="tb-btn" title="Batch Generators — cast, beat sheet, chapter draft" onClick={() => setModal('batch-generator')}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M2 3h5v4H2zM9 3h5v4H9zM2 9h5v4H2zM9 9h5v4H9z" />
            </svg>
            Generate
          </button>
          <button className="tb-btn" title="Autopilot (⌘⇧P)" onClick={() => setModal('autopilot')}>▶▶</button>
          <div className="tb-sep" />
          <button className="tb-btn" title="AI Settings" onClick={() => setModal('ai-settings')} style={{ color: 'var(--accent)' }}>
            <span style={{ fontSize: 14 }}>✦</span> AI
          </button>
        </>
      ) : (
        <button className="tb-btn ai-enable" title="Enable AI (⌘⇧A)" onClick={() => setModal('ai-settings')}>
          <span className="ai-spark">✦</span> AI
        </button>
      )}
    </div>
  )
}
