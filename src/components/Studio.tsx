import React from 'react'
import { useShellStore } from '../store/shellStore'
import { useProjectStore } from '../store/projectStore'
import { useAIStore } from '../store/aiStore'
import { spliceSelection } from '../lib/ProposalService'
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
import AssistantPanel from './assistant/AssistantPanel'
import StatsModal from './modals/StatsModal'
import AutopilotModal from './modals/AutopilotModal'
import CommandPalette from './modals/CommandPalette'
import HistoryModal from './modals/HistoryModal'
import DebtInboxModal from './modals/DebtInboxModal'
import FoundationModal from './modals/FoundationModal'
import BestOfModal from './modals/BestOfModal'
import CriticModal from './modals/CriticModal'
import { debtService } from '../lib/DebtService'

export default function Studio(): React.ReactElement {
  const layout = useShellStore((s) => s.layout)
  const modal = useShellStore((s) => s.modal)
  const setModal = useShellStore((s) => s.setModal)
  const assistantOpen = useShellStore((s) => s.assistantOpen)
  const setAssistantOpen = useShellStore((s) => s.setAssistantOpen)
  const aiEnabled = useAIStore((s) => s.enabled)
  const compositionMode = useProjectStore((s) => s.compositionMode)
  const focusMode = useProjectStore((s) => s.focusMode)
  const splitOpen = useProjectStore((s) => s.splitOpen)
  const splitId = useProjectStore((s) => s.splitId)

  const activeProposalId = useProjectStore((s) => s.activeProposalId)
  const proposals = useProjectStore((s) => s.proposals)
  const resolveProposal = useProjectStore((s) => s.resolveProposal)
  const updateContent = useProjectStore((s) => s.updateContent)
  const addSnapshot = useProjectStore((s) => s.addSnapshot)
  const raiseDebt = useProjectStore((s) => s.raiseDebt)
  const resolveDebtAffected = useProjectStore((s) => s.resolveDebtAffected)
  const project = useProjectStore((s) => s.project)

  const activeProposal = activeProposalId
    ? proposals.find((p) => p.id === activeProposalId) ?? null
    : null

  const showBinder = layout.binder && !focusMode
  const showInsp = layout.insp && !focusMode
  const showAssistant = assistantOpen && aiEnabled && !focusMode

  React.useEffect(() => {
    if (!aiEnabled && assistantOpen) setAssistantOpen(false)
  }, [aiEnabled, assistantOpen, setAssistantOpen])

  // Keyboard-first: closing any modal hands focus back to the editor so the
  // writer can keep typing without reaching for the mouse.
  const prevModal = React.useRef(modal)
  React.useEffect(() => {
    if (prevModal.current !== null && modal === null) {
      window.dispatchEvent(new CustomEvent('konbini:focus-editor'))
    }
    prevModal.current = modal
  }, [modal])

  const bodyClass = [
    'body',
    !layout.binder ? 'no-binder' : '',
    !layout.insp ? 'no-insp' : '',
    focusMode ? 'focus-mode' : '',
    showAssistant ? 'asst-open' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className="studio">
      <Titlebar />
      <Toolbar />
      <div className={bodyClass}>
        {/* Always keep a grid child in slot 1 so the editor stays in column 2. */}
        {showBinder ? <Binder /> : <div />}
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
        {/* Always keep a grid child in slot 3 so the editor stays in column 2. */}
        {showAssistant ? <AssistantPanel /> : showInsp ? <Inspector /> : <div />}
      </div>
      <StatusBar />

      {compositionMode && <CompositionMode />}

      {modal === 'command-palette' && <CommandPalette onClose={() => setModal(null)} />}
      {modal === 'history'     && <HistoryModal    onClose={() => setModal(null)} />}
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
      {modal === 'stats'           && <StatsModal           onClose={() => setModal(null)} />}
      {modal === 'autopilot'       && <AutopilotModal       onClose={() => setModal(null)} />}
      {modal === 'debt'            && <DebtInboxModal       onClose={() => setModal(null)} />}
      {modal === 'foundation'      && <FoundationModal      onClose={() => setModal(null)} />}
      {modal === 'bestof'          && <BestOfModal          onClose={() => setModal(null)} />}
      {modal === 'critic'          && <CriticModal          onClose={() => setModal(null)} />}

      {activeProposal && (
        <ChangesetModal
          proposal={activeProposal}
          onApply={async (content, accepted) => {
            if (!project) return

            const docContent = project.docs[activeProposal.docId]?.content ?? ''
            let resolvedContent = content
            if (activeProposal.scope === 'selection') {
              const result = spliceSelection(docContent, activeProposal, content)
              if ('error' in result) {
                useShellStore.getState().setToast('Selection changed since this proposal was made — discard and re-run.')
                return
              }
              resolvedContent = result.content
            }

            // Flush the current editor content to disk first — the snapshot
            // service reads its own cached copy, which only updates on write
            // and can otherwise be up to one autosave cycle stale.
            await window.api.doc.write(project.id, activeProposal.docId, docContent)
            // Snapshot first (invariant: pre-AI snapshot is mandatory)
            const snap = await window.api.snapshot.take(project.id, activeProposal.docId, `Before ${activeProposal.label}`)
            addSnapshot(activeProposal.docId, snap)
            updateContent(activeProposal.docId, resolvedContent)
            resolveProposal(activeProposal.id, 'applied')
            // If this proposal was reconciling a debt item, applying it closes
            // that affected document.
            if (activeProposal.debtRef) {
              resolveDebtAffected(activeProposal.debtRef.debtId, activeProposal.debtRef.docId)
            }
            // Prose→outline debt: a substantial whole-doc revision may have
            // outdated the scene's synopsis.
            const debtItem = debtService.maybeRaiseFromProposal({ project, proposal: activeProposal, applied: resolvedContent })
            if (debtItem) raiseDebt(debtItem)
          }}
          onDiscard={() => resolveProposal(activeProposal.id, 'discarded')}
        />
      )}
    </div>
  )
}
