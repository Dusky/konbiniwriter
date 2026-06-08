import React from 'react'
import { useShellStore } from '../store/shellStore'
import { useProjectStore } from '../store/projectStore'
import Titlebar from './shell/Titlebar'
import Toolbar from './shell/Toolbar'
import StatusBar from './shell/StatusBar'
import Binder from './binder/Binder'
import Inspector from './inspector/Inspector'
import EditorPane from './editor/EditorPane'
import CompositionMode from './editor/CompositionMode'
import SnapshotModal from './modals/SnapshotModal'
import CompileModal from './modals/CompileModal'
import ShortcutsModal from './modals/ShortcutsModal'
import AboutModal from './modals/AboutModal'
import NewProjectModal from './modals/NewProjectModal'
import PrefsModal from './modals/PrefsModal'
import SearchModal from './modals/SearchModal'
import ChangesetModal from './modals/ChangesetModal'
import PromptRegistryModal from './modals/PromptRegistryModal'
import CodexModal from './modals/CodexModal'
import AISettingsModal from './modals/AISettingsModal'
import BatchGeneratorModal from './modals/BatchGeneratorModal'
import ReaderModal from './modals/ReaderModal'
import ChatModal from './modals/ChatModal'
import StatsModal from './modals/StatsModal'
import AutopilotModal from './modals/AutopilotModal'

export default function Studio(): React.ReactElement {
  const layout = useShellStore((s) => s.layout)
  const modal = useShellStore((s) => s.modal)
  const setModal = useShellStore((s) => s.setModal)
  const compositionMode = useProjectStore((s) => s.compositionMode)
  const splitOpen = useProjectStore((s) => s.splitOpen)
  const splitId = useProjectStore((s) => s.splitId)

  const activeProposalId = useProjectStore((s) => s.activeProposalId)
  const proposals = useProjectStore((s) => s.proposals)
  const resolveProposal = useProjectStore((s) => s.resolveProposal)
  const updateContent = useProjectStore((s) => s.updateContent)
  const addSnapshot = useProjectStore((s) => s.addSnapshot)
  const project = useProjectStore((s) => s.project)

  const activeProposal = activeProposalId
    ? proposals.find((p) => p.id === activeProposalId) ?? null
    : null

  const bodyClass = [
    'body',
    !layout.binder ? 'no-binder' : '',
    !layout.insp ? 'no-insp' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className="studio">
      <Titlebar />
      <Toolbar />
      <div className={bodyClass}>
        {layout.binder && <Binder />}
        {splitOpen ? (
          <div style={{ display: 'flex', flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid var(--border)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <EditorPane splitOpen={splitOpen} pane="left" />
            </div>
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <EditorPane splitOpen={splitOpen} pane="right" nodeId={splitId ?? undefined} />
            </div>
          </div>
        ) : (
          <EditorPane splitOpen={false} pane="left" />
        )}
        {layout.insp && <Inspector />}
      </div>
      <StatusBar />

      {compositionMode && <CompositionMode />}

      {modal === 'snapshot'    && <SnapshotModal   onClose={() => setModal(null)} />}
      {modal === 'compile'     && <CompileModal    onClose={() => setModal(null)} />}
      {modal === 'shortcuts'   && <ShortcutsModal  onClose={() => setModal(null)} />}
      {modal === 'about'       && <AboutModal      onClose={() => setModal(null)} />}
      {modal === 'new-project' && <NewProjectModal  onClose={() => setModal(null)} />}
      {modal === 'prefs'       && <PrefsModal       onClose={() => setModal(null)} />}
      {modal === 'search'          && <SearchModal         onClose={() => setModal(null)} />}
      {modal === 'prompt-registry' && <PromptRegistryModal  onClose={() => setModal(null)} />}
      {modal === 'codex'           && <CodexModal           onClose={() => setModal(null)} />}
      {modal === 'ai-settings'     && <AISettingsModal      onClose={() => setModal(null)} />}
      {modal === 'batch-generator' && <BatchGeneratorModal  onClose={() => setModal(null)} />}
      {modal === 'reader'          && <ReaderModal          onClose={() => setModal(null)} />}
      {modal === 'chat'            && <ChatModal            onClose={() => setModal(null)} />}
      {modal === 'stats'           && <StatsModal           onClose={() => setModal(null)} />}
      {modal === 'autopilot'       && <AutopilotModal       onClose={() => setModal(null)} />}

      {activeProposal && (
        <ChangesetModal
          proposal={activeProposal}
          onApply={async (content, accepted) => {
            if (!project) return
            // Snapshot first (invariant: pre-AI snapshot is mandatory)
            const snap = await window.api.snapshot.take(project.id, activeProposal.docId, `Before ${activeProposal.label}`)
            addSnapshot(activeProposal.docId, snap)
            updateContent(activeProposal.docId, content)
            resolveProposal(activeProposal.id, 'applied')
          }}
          onDiscard={() => resolveProposal(activeProposal.id, 'discarded')}
        />
      )}
    </div>
  )
}
