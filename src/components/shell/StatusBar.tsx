import React from 'react'
import { useProjectStore, subtreeWordCount } from '../../store/projectStore'
import { wordCount, charCount } from '@shared/utils'

export default function StatusBar(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const saveStatus = useProjectStore((s) => s.saveStatus)
  const view = useProjectStore((s) => s.view)

  const selectedNode = selectedId && project ? project.nodes[selectedId] : null
  const docContent = selectedId && project && selectedNode?.type !== 'folder'
    ? (project.docs[selectedId]?.content ?? '')
    : ''

  const docWords = wordCount(docContent)
  const docChars = charCount(docContent)

  const totalWords = project
    ? project.rootIds.reduce((acc, id) => acc + subtreeWordCount(project, id), 0)
    : 0

  return (
    <div className="statusbar">
      {selectedNode && (
        <span>
          <b>{selectedNode.title}</b>
          {' · '}{selectedNode.type}
        </span>
      )}
      {selectedNode?.type !== 'folder' && docWords > 0 && (
        <span><b>{docWords}</b> words · <b>{docChars}</b> chars</span>
      )}

      <div className="sb-r">
        {project && <span>Project: <b>{totalWords.toLocaleString()}</b> words</span>}
        <span style={{ color: saveStatus === 'saving' ? 'var(--st-prog)' : 'var(--text-3)' }}>
          {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : ''}
        </span>
      </div>
    </div>
  )
}
