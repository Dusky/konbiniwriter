import React, { useState } from 'react'
import { useProjectStore, subtreeWordCount } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
import { wordCount, charCount } from '@shared/utils'

export default function StatusBar(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const saveStatus = useProjectStore((s) => s.saveStatus)
  const setProjectWordTarget = useProjectStore((s) => s.setProjectWordTarget)
  const sessionWordsAdded = useProjectStore((s) => s.sessionWordsAdded)
  const cursor = useProjectStore((s) => s.cursor)
  const view = useProjectStore((s) => s.view)
  const setModal = useShellStore((s) => s.setModal)

  const selectedNode = selectedId && project ? project.nodes[selectedId] : null
  const docContent = selectedId && project && selectedNode?.type !== 'folder'
    ? (project.docs[selectedId]?.content ?? '')
    : ''

  const docWords = wordCount(docContent)
  const docChars = charCount(docContent)

  // Project total excludes the Trash subtree — discarded work shouldn't count.
  const totalWords = project
    ? project.rootIds
        .filter((id) => id !== project.trashId)
        .reduce((acc, id) => acc + subtreeWordCount(project, id), 0)
    : 0

  const wordTarget = project?.settings?.wordTarget
  const progress = wordTarget ? Math.min(1, totalWords / wordTarget) : null

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function commitTarget() {
    const n = parseInt(draft.replace(/[^0-9]/g, ''), 10)
    setProjectWordTarget(isNaN(n) || n <= 0 ? undefined : n)
    setEditing(false)
  }

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
      {view === 'editor' && selectedNode?.type !== 'folder' && cursor && (
        <span style={{ color: 'var(--text-3)' }}>
          Ln <b>{cursor.line}</b>, Col <b>{cursor.col}</b>
        </span>
      )}

      <div className="sb-r">
        {project && (
          <span
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            title="Click to set word-count goal"
            onClick={() => { setDraft(wordTarget?.toString() ?? ''); setEditing(true) }}
          >
            Project: <b>{totalWords.toLocaleString()}</b>
                {sessionWordsAdded > 0 && (
                  <span
                    style={{ color: 'var(--text-3)', fontWeight: 'normal', cursor: 'pointer' }}
                    title="View Writing Stats"
                    onClick={(e) => { e.stopPropagation(); setModal('stats') }}
                  >
                    {' · '}+{sessionWordsAdded.toLocaleString()} this session
                  </span>
                )}
            {wordTarget && (
              <> / <b>{wordTarget.toLocaleString()}</b> words
                <span
                  style={{
                    display: 'inline-block', width: 48, height: 4,
                    background: 'var(--border)', borderRadius: 2, overflow: 'hidden',
                    verticalAlign: 'middle', marginLeft: 4,
                  }}
                >
                  <span style={{
                    display: 'block', height: '100%',
                    width: `${(progress ?? 0) * 100}%`,
                    background: progress === 1 ? 'var(--st-final)' : 'var(--accent)',
                    borderRadius: 2,
                    transition: 'width 0.3s',
                  }} />
                </span>
              </>
            )}
            {!wordTarget && <span style={{ color: 'var(--text-3)', marginLeft: 2 }}>words</span>}
          </span>
        )}
        {editing && (
          <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              autoFocus
              type="number"
              min={0}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitTarget}
              onKeyDown={(e) => { if (e.key === 'Enter') commitTarget(); if (e.key === 'Escape') setEditing(false) }}
              style={{ width: 80, padding: '0 4px', height: 20, fontSize: 12, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 3, color: 'inherit' }}
              placeholder="goal"
            />
          </span>
        )}
        <span style={{ color: saveStatus === 'saving' ? 'var(--st-prog)' : 'var(--text-3)' }}>
          {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : ''}
        </span>
      </div>
    </div>
  )
}
