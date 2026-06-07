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

export default function Studio(): React.ReactElement {
  const layout = useShellStore((s) => s.layout)
  const modal = useShellStore((s) => s.modal)
  const setModal = useShellStore((s) => s.setModal)
  const compositionMode = useProjectStore((s) => s.compositionMode)
  const platform = useShellStore((s) => s.platform)

  const activeProposalId = useProjectStore((s) => s.activeProposalId)
  const proposals = useProjectStore((s) => s.proposals)
  const queueProposal = useProjectStore((s) => s.queueProposal)
  const resolveProposal = useProjectStore((s) => s.resolveProposal)
  const updateContent = useProjectStore((s) => s.updateContent)
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
        <EditorPane />
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

      {activeProposal && (
        <ChangesetModal
          proposal={activeProposal}
          onApply={async (content, accepted) => {
            if (!project) return
            // Snapshot first (invariant: pre-AI snapshot is mandatory)
            await window.api.snapshot.take(project.id, activeProposal.docId, `Before ${activeProposal.label}`)
            updateContent(activeProposal.docId, content)
            resolveProposal(activeProposal.id, 'applied')
          }}
          onDiscard={() => resolveProposal(activeProposal.id, 'discarded')}
        />
      )}
    </div>
  )
}
