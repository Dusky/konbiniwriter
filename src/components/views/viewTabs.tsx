import React from 'react'
import type { ViewTabId } from '../../store/projectStore'
import type { IconName } from '../common/Icon'
import StatsModal from '../modals/StatsModal'

// Registry of app-view tabs: the tab's label + icon, and how to render the
// surface embedded in the main pane. Each surface reuses its existing modal
// component in `embedded` mode (see ModalShell). Single source of truth for
// TabStrip (chrome) and EditorPane (content).
export interface ViewTabDef {
  label: string
  icon: IconName
  render: (onClose: () => void) => React.ReactNode
}

export const VIEW_TABS: Partial<Record<ViewTabId, ViewTabDef>> = {
  stats: { label: 'Stats', icon: 'chart', render: (onClose) => <StatsModal embedded onClose={onClose} /> },
}
