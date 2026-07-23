import React from 'react'
import { useShellStore, type RailPanel } from '../../store/shellStore'
import { useAIStore } from '../../store/aiStore'
import Icon from '../common/Icon'
import SidebarResizer from '../common/SidebarResizer'
import Inspector from '../inspector/Inspector'
import AssistantPanel from '../assistant/AssistantPanel'
import CodexPanel from '../panels/CodexPanel'
import ReaderPanel from '../panels/ReaderPanel'
import CriticPanel from '../panels/CriticPanel'

// The right rail hosts exactly one panel; the tab strip makes the choices
// visible and switchable so nothing silently vanishes. Inspector is always
// available; the rest require AI on.
const TABS: { id: Exclude<RailPanel, null>; label: string; ai: boolean }[] = [
  { id: 'inspector', label: 'Inspector', ai: false },
  { id: 'assistant', label: 'Chat',      ai: true },
  { id: 'codex',     label: 'Codex',     ai: true },
  { id: 'reader',    label: 'Readers',   ai: true },
  { id: 'critic',    label: 'Critic',    ai: true },
]

export default function RightRail(): React.ReactElement {
  const railPanel = useShellStore((s) => s.railPanel)
  const setRailPanel = useShellStore((s) => s.setRailPanel)
  const aiEnabled = useAIStore((s) => s.enabled)
  const tabs = TABS.filter((t) => !t.ai || aiEnabled)

  return (
    <div className="rail">
      <SidebarResizer edge="left" cssVar="--insp-w" prefKey="pref:inspWidth" min={220} max={560} fallback={286} />
      <div className="rail-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={railPanel === t.id ? 'on' : ''}
            aria-pressed={railPanel === t.id}
            onClick={() => setRailPanel(t.id)}
          >
            {t.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button className="rail-close" onClick={() => setRailPanel(null)} title="Close panel" aria-label="Close panel"><Icon name="x" size={14} /></button>
      </div>
      <div className="rail-body">
        {railPanel === 'codex' ? <CodexPanel />
          : railPanel === 'reader' ? <ReaderPanel />
          : railPanel === 'critic' ? <CriticPanel />
          : railPanel === 'assistant' ? <AssistantPanel />
          : <Inspector />}
      </div>
    </div>
  )
}
