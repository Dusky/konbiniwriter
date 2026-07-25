import React, { useState } from 'react'
import { useShellStore } from '../../store/shellStore'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import ContextMenu from '../common/ContextMenu'
import Icon from '../common/Icon'
import { kbd } from '../../lib/kbd'

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
          title={`Toggle Binder (${kbd('mod+alt+b')})`}
          aria-label="Toggle Binder"
          aria-pressed={layout.binder}
          onClick={toggleBinder}
        >
          <Icon name="panel-left" />
        </button>
      </div>

      <div className="tb-sep" />

      {/* View segmented control */}
      <div className="seg">
        <button className={view === 'editor'    ? 'on' : ''} onClick={() => setView('editor')}    title={`Editor (${kbd('mod+1')})`}>Editor</button>
        <button className={view === 'corkboard' ? 'on' : ''} onClick={() => setView('corkboard')} title={`Corkboard (${kbd('mod+2')})`}>Corkboard</button>
        <button className={view === 'outliner'  ? 'on' : ''} onClick={() => setView('outliner')}  title={`Outliner (${kbd('mod+3')})`}>Outliner</button>
        <button className={view === 'timeline'  ? 'on' : ''} onClick={() => setView('timeline')}  title={`Timeline (${kbd('mod+4')})`}>Timeline</button>
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        <button
          className={`tb-btn${splitOpen ? ' on' : ''}`}
          title={`Split Editor (${kbd('mod+\\')})`}
          aria-label="Split Editor"
          aria-pressed={splitOpen}
          onClick={toggleSplit}
        >
          <Icon name="columns" />
        </button>
        <button
          className={`tb-btn${focusMode ? ' on' : ''}`}
          title={`Focus Mode (${kbd('mod+alt+o')})`}
          aria-label="Focus Mode"
          aria-pressed={focusMode}
          onClick={() => setFocusMode(!focusMode)}
        >
          <Icon name="focus" />
        </button>
        <button
          className="tb-btn"
          title={`Composition Mode (${kbd('mod+alt+c')})`}
          aria-label="Composition Mode"
          onClick={() => setCompositionMode(true)}
        >
          <Icon name="notebook" />
        </button>
      </div>

      <div className="tb-spacer" />

      <div className="tb-group">
        <button className="tb-btn" title={`Take Snapshot (${kbd('mod+shift+s')})`} onClick={() => setModal('history')}>
          <Icon name="history" />
          Snapshot
        </button>
        <button className="tb-btn" title={`Compile (${kbd('mod+shift+e')})`} onClick={() => setModal('compile')}>
          <Icon name="file-output" />
          Compile
        </button>
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        <button
          className={`tb-btn${railPanel === 'inspector' ? ' on' : ''}`}
          title={`Toggle Inspector (${kbd('mod+alt+i')})`}
          aria-label="Toggle Inspector"
          aria-pressed={railPanel === 'inspector'}
          onClick={() => toggleRailPanel('inspector')}
        >
          <Icon name="panel-right" />
        </button>
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        <button className="tb-btn" title={`Find & Replace (${kbd('mod+h')})`} aria-label="Find and Replace" onClick={() => {
          // The inline find bar lives inside a mounted document Editor. When the
          // main pane is anything else (empty state, a folder/Scrivenings view,
          // or corkboard/outliner/timeline) nothing listens, so fall back to the
          // project-wide search — always a working find & replace.
          const canInlineFind = view === 'editor' && selectedNode && selectedNode.type !== 'folder'
          if (canInlineFind) window.dispatchEvent(new CustomEvent('konbini:toggle-find'))
          else setModal('search')
        }}>
          <Icon name="text-search" />
        </button>
        <button className="tb-btn" title={`Search Project (${kbd('mod+shift+f')})`} aria-label="Search Project" onClick={() => setModal('search')}>
          <Icon name="search" />
        </button>
        <button className="tb-btn" title="Writing Stats" aria-label="Writing Stats" onClick={() => setModal('stats')}>
          <Icon name="chart" />
        </button>
        <button className="tb-btn" title={`Preferences (${kbd('mod+,')})`} aria-label="Preferences" onClick={() => setModal('prefs')}>
          <Icon name="settings" />
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
            <span className="ai-spark"><Icon name="sparkle" size={13} /></span> AI <Icon name="chevron-down" size={12} style={{ opacity: 0.7 }} />
            {(debtOpen > 0 || slopCount > 0) && <span className="ai-dot" />}
          </button>
          <button className="tb-btn" title="AI Settings" aria-label="AI Settings" onClick={() => setModal('ai-settings')} style={{ color: 'var(--accent)' }}>
            <Icon name="settings-2" />
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
                { label: `Generate beat — inline (${kbd('mod+j')})`, action: () => window.dispatchEvent(new CustomEvent('konbini:generate-beat')) },
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
        <button className="tb-btn ai-enable" title={`Enable AI (${kbd('mod+shift+a')})`} onClick={() => setModal('ai-settings')}>
          <span className="ai-spark"><Icon name="sparkle" size={13} /></span> AI
        </button>
      )}
    </div>
  )
}
