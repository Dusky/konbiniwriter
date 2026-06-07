import React from 'react'
import { useShellStore } from '../../store/shellStore'
import { fmtKey } from '@shared/utils'

const SHORTCUTS = [
  {
    heading: 'File',
    rows: [
      ['Open Project', 'mod+o'],
      ['New Folder', 'mod+alt+n'],
      ['New Document', 'mod+shift+d'],
      ['New Scene', 'mod+shift+n'],
      ['Take Snapshot', 'mod+shift+s'],
      ['Compile', 'mod+shift+e'],
      ['Close Project', 'mod+w'],
    ],
  },
  {
    heading: 'Edit',
    rows: [
      ['Undo Text', 'mod+z'],
      ['Undo Tree Change', 'mod+z'],
      ['Find in Document', 'mod+f'],
      ['Search Project', 'mod+shift+f'],
    ],
  },
  {
    heading: 'View',
    rows: [
      ['Editor', 'mod+1'],
      ['Corkboard', 'mod+2'],
      ['Outliner', 'mod+3'],
      ['Toggle Binder', 'mod+alt+b'],
      ['Toggle Inspector', 'mod+alt+i'],
      ['Composition Mode', 'mod+alt+c'],
      ['Focus Mode', 'mod+alt+o'],
      ['Light / Dark', 'mod+alt+t'],
    ],
  },
  {
    heading: 'Other',
    rows: [
      ['Preferences', 'mod+,'],
      ['Keyboard Shortcuts', 'mod+/'],
    ],
  },
  {
    heading: 'AI',
    rows: [
      ['AI Chat', 'mod+shift+a'],
      ['AI Settings / Enable', ''],
      ['Codex', 'mod+shift+k'],
      ['Reader Panel', 'mod+shift+r'],
      ['Batch Generator', 'mod+shift+g'],
      ['Prompt Registry', ''],
    ],
  },
]

interface Props { onClose: () => void }

export default function ShortcutsModal({ onClose }: Props): React.ReactElement {
  const platform = useShellStore((s) => s.platform)

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 780 }}>
        <div className="modal-hd"><h3>Keyboard Shortcuts</h3></div>
        <div className="modal-body">
          <div className="sc-grid">
            {SHORTCUTS.map((section) => (
              <div key={section.heading} className="sc-col">
                <div className="sc-head">{section.heading}</div>
                {section.rows.map(([label, combo]) => (
                  <div key={label} className="sc-row">
                    <span>{label}</span>
                    <kbd style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-2)' }}>
                      {fmtKey(combo, platform)}
                    </kbd>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
