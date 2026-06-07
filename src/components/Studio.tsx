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

export default function Studio(): React.ReactElement {
  const layout = useShellStore((s) => s.layout)
  const modal = useShellStore((s) => s.modal)
  const setModal = useShellStore((s) => s.setModal)
  const compositionMode = useProjectStore((s) => s.compositionMode)
  const platform = useShellStore((s) => s.platform)

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

      {modal === 'snapshot'    && <SnapshotModal  onClose={() => setModal(null)} />}
      {modal === 'compile'     && <CompileModal   onClose={() => setModal(null)} />}
      {modal === 'shortcuts'   && <ShortcutsModal onClose={() => setModal(null)} />}
      {modal === 'about'       && <AboutModal     onClose={() => setModal(null)} />}
      {modal === 'new-project' && <NewProjectModal onClose={() => setModal(null)} />}
    </div>
  )
}
