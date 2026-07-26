import React, { useEffect } from 'react'
import { useShellStore } from '../store/shellStore'
import { useProjectStore } from '../store/projectStore'
import { useAIStore } from '../store/aiStore'
import { applyConfigChange } from '../lib/agentConfig'
import { spliceSelection } from '../lib/ProposalService'
import Titlebar from './shell/Titlebar'
import Toolbar from './shell/Toolbar'
import StatusBar from './shell/StatusBar'
import Binder from './binder/Binder'
import RightRail from './shell/RightRail'
import { isAIPanel } from './shell/railTabs'
import EditorPane from './editor/EditorPane'
import CompositionMode from './editor/CompositionMode'
import CompileModal from './modals/CompileModal'
import ShortcutsModal from './modals/ShortcutsModal'
import AboutModal from './modals/AboutModal'
import NewProjectModal from './modals/NewProjectModal'
import SearchModal from './modals/SearchModal'
import ChangesetModal from './modals/ChangesetModal'
import CommandPalette from './modals/CommandPalette'
import DebtInboxModal from './modals/DebtInboxModal'
import { debtService } from '../lib/DebtService'
import { syncService } from '../lib/SyncService'
import { useExternalChanges } from '../lib/useExternalChanges'

export default function Studio(): React.ReactElement {
  const layout = useShellStore((s) => s.layout)
  const modal = useShellStore((s) => s.modal)
  const setModal = useShellStore((s) => s.setModal)
  const railPanel = useShellStore((s) => s.railPanel)
  const setRailPanel = useShellStore((s) => s.setRailPanel)
  const aiEnabled = useAIStore((s) => s.enabled)
  const compositionMode = useProjectStore((s) => s.compositionMode)
  const focusMode = useProjectStore((s) => s.focusMode)
  const splitOpen = useProjectStore((s) => s.splitOpen)
  const splitId = useProjectStore((s) => s.splitId)

  // Load persisted judge/quality scores when a project opens.
  const hydrateProjectId = useProjectStore((s) => s.project?.id)
  const hydrateJudgeResults = useProjectStore((s) => s.hydrateJudgeResults)
  useEffect(() => { if (hydrateProjectId) void hydrateJudgeResults() }, [hydrateProjectId, hydrateJudgeResults])

  // Notice when an external syncer changes the bundle under us.
  useExternalChanges()

  // Record a sync ancestor on first open — the bundle we just read IS the
  // common ancestor, so the first external change reconciles cleanly instead of
  // looking like a conflict.
  useEffect(() => {
    const p = useProjectStore.getState().project
    if (p) syncService.ensureBaseline(p)
  }, [hydrateProjectId])

  // Apply persisted sidebar widths on mount (the resizers write these prefs).
  useEffect(() => {
    const bw = window.api.prefs.get('pref:binderWidth')
    if (bw) document.documentElement.style.setProperty('--binder-w', `${bw}px`)
    const iw = window.api.prefs.get('pref:inspWidth')
    if (iw) document.documentElement.style.setProperty('--insp-w', `${iw}px`)
  }, [])

  // External-edit conflicts: another program changed a doc on disk, and our next
  // save preserved that version as a .conflict backup. Warn so nothing is lost silently.
  useEffect(() => {
    const unsub = window.api.doc.onConflict?.((e) => {
      const title = useProjectStore.getState().project?.nodes[e.nodeId]?.title ?? 'A document'
      useShellStore.getState().setToast(`"${title}" was edited outside Konbini — that version was saved as ${e.file}, so nothing was lost.`, 'info')
    })
    return unsub
  }, [])

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
  // The right rail shows one panel at a time. AI panels require AI on; focus
  // mode hides the rail entirely.
  const activeRail = focusMode ? null : railPanel

  React.useEffect(() => {
    // AI turned off while an AI panel was docked — fall back to the inspector.
    // Which panels count as AI lives in railTabs, beside the tab strip, so a
    // new non-AI panel can't be silently locked out here.
    if (!aiEnabled && isAIPanel(railPanel)) setRailPanel('inspector')
  }, [aiEnabled, railPanel, setRailPanel])

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
    activeRail === null ? 'no-insp' : '',
    focusMode ? 'focus-mode' : '',
    activeRail === 'codex' ? 'rail-wide' : '',
    activeRail && activeRail !== 'codex' ? 'rail-open' : '',
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
        {/* Always keep a grid child in slot 3 so the editor stays in column 2.
            The tabbed rail owns the panel switching. */}
        {activeRail ? <RightRail /> : <div />}
      </div>
      <StatusBar />

      {compositionMode && <CompositionMode />}

      {modal === 'command-palette' && <CommandPalette onClose={() => setModal(null)} />}
      {modal === 'compile'     && <CompileModal    onClose={() => setModal(null)} />}
      {modal === 'shortcuts'   && <ShortcutsModal  onClose={() => setModal(null)} />}
      {modal === 'about'       && <AboutModal      onClose={() => setModal(null)} />}
      {modal === 'new-project' && <NewProjectModal  onClose={() => setModal(null)} />}
      {modal === 'search'          && <SearchModal         onClose={() => setModal(null)} />}
      {modal === 'debt'            && <DebtInboxModal       onClose={() => setModal(null)} />}

      {activeProposal && (
        <ChangesetModal
          key={activeProposal.id}
          proposal={activeProposal}
          onApply={async (content, accepted) => {
            if (!project) return

            // A settings proposal is reviewed through the same modal but is not
            // a document: there is no .md to write and no prose to snapshot, and
            // the write goes through the whitelist in lib/agentConfig.ts. Handled
            // first so none of the document machinery below can touch it.
            if (activeProposal.configRef) {
              const err = applyConfigChange(activeProposal.configRef, content)
              if (err) { useShellStore.getState().setToast(err); return }
              resolveProposal(activeProposal.id, 'applied')
              useShellStore.getState().setToast(`${activeProposal.docTitle} updated`, 'info')
              return
            }

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
            // Persist the applied content directly. updateContent only touches the
            // store; disk otherwise relies on the target doc's autosave, which only
            // runs for the *active* editor — so a proposal applied to a doc that
            // isn't open (find-&-replace, debt fixes, batch) would never reach disk.
            await window.api.doc.write(project.id, activeProposal.docId, resolvedContent)
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
