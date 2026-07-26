import React from 'react'
import { useShellStore } from '../../store/shellStore'
import { RAIL_TABS } from './railTabs'
import { useAIStore } from '../../store/aiStore'
import Icon from '../common/Icon'
import SidebarResizer from '../common/SidebarResizer'
import Inspector from '../inspector/Inspector'
import AssistantPanel from '../assistant/AssistantPanel'
import CodexPanel from '../panels/CodexPanel'
import ReaderPanel from '../panels/ReaderPanel'
import CriticPanel from '../panels/CriticPanel'
import CommentsPanel from '../panels/CommentsPanel'
import HistoryModal from '../modals/HistoryModal'


export default function RightRail(): React.ReactElement {
  const railPanel = useShellStore((s) => s.railPanel)
  const setRailPanel = useShellStore((s) => s.setRailPanel)
  const aiEnabled = useAIStore((s) => s.enabled)
  // The rail hosts exactly one panel; the tab strip makes the choices visible
  // and switchable so nothing silently vanishes. AI panels appear only with AI on.
  const tabs = RAIL_TABS.filter((t) => !t.ai || aiEnabled)

  return (
    <aside className="rail" aria-label="Inspector">
      <SidebarResizer edge="left" cssVar="--insp-w" prefKey="pref:inspWidth"
        min={railPanel === 'codex' ? 320 : 240} max={560}
        fallback={railPanel === 'codex' ? 420 : 340} />
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
        {railPanel === 'comments' ? <CommentsPanel />
          : railPanel === 'codex' ? <CodexPanel />
          : railPanel === 'reader' ? <ReaderPanel />
          : railPanel === 'critic' ? <CriticPanel />
          : railPanel === 'assistant' ? <AssistantPanel />
          : railPanel === 'history' ? <HistoryModal rail onClose={() => setRailPanel(null)} />
          : <Inspector />}
      </div>
    </aside>
  )
}
