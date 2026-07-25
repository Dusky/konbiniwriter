import React from 'react'
import type { ViewTabId } from '../../store/projectStore'
import type { IconName } from '../common/Icon'
import StatsModal from '../modals/StatsModal'
import PrefsModal from '../modals/PrefsModal'
import ThemesModal from '../modals/ThemesModal'
import AISettingsModal from '../modals/AISettingsModal'
import FoundationModal from '../modals/FoundationModal'
import PromptRegistryModal from '../modals/PromptRegistryModal'
import BatchGeneratorModal from '../modals/BatchGeneratorModal'
import BestOfModal from '../modals/BestOfModal'
import AutopilotModal from '../modals/AutopilotModal'

// Registry of app-view tabs: the tab's label + icon, and how to render the
// surface embedded in the main pane. Each surface reuses its existing modal
// component in `embedded` mode (see ModalShell). Single source of truth for
// TabStrip (chrome) and EditorPane (content).
export interface ViewTabDef {
  label: string
  icon: IconName
  render: (onClose: () => void) => React.ReactNode
}

export const VIEW_TABS: Record<ViewTabId, ViewTabDef> = {
  stats:            { label: 'Stats',       icon: 'chart',      render: (c) => <StatsModal embedded onClose={c} /> },
  prefs:            { label: 'Preferences', icon: 'settings',   render: (c) => <PrefsModal embedded onClose={c} /> },
  themes:           { label: 'Themes',      icon: 'palette',    render: (c) => <ThemesModal embedded onClose={c} /> },
  'ai-settings':    { label: 'AI Settings', icon: 'settings-2', render: (c) => <AISettingsModal embedded onClose={c} /> },
  foundation:       { label: 'Foundation',  icon: 'sparkle',    render: (c) => <FoundationModal embedded onClose={c} /> },
  'prompt-registry':{ label: 'Prompts',     icon: 'library',    render: (c) => <PromptRegistryModal embedded onClose={c} /> },
  'batch-generator':{ label: 'Generate',    icon: 'wand',       render: (c) => <BatchGeneratorModal embedded onClose={c} /> },
  bestof:           { label: 'Best of N',   icon: 'trophy',     render: (c) => <BestOfModal embedded onClose={c} /> },
  autopilot:        { label: 'Autopilot',   icon: 'rocket',     render: (c) => <AutopilotModal embedded onClose={c} /> },
}
