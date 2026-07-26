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
      ['History / Snapshots', 'mod+shift+s'],
      ['Compile', 'mod+shift+e'],
      ['Close Project', 'mod+w'],
    ],
  },
  {
    heading: 'Edit',
    rows: [
      ['Undo (text / tree)', 'mod+z'],
      ['Redo (text / tree)', 'mod+shift+z'],
      ['Find in Document', 'mod+f'],
      ['Find & Replace', 'mod+h'],
      ['Search Project', 'mod+shift+f'],
      ['Add Comment', 'mod+shift+m'],
      ['Read Aloud', 'mod+shift+l'],
    ],
  },
  {
    heading: 'View',
    rows: [
      ['Editor', 'mod+1'],
      ['Corkboard', 'mod+2'],
      ['Outliner', 'mod+3'],
      ['Timeline', 'mod+4'],
      ['Toggle Binder', 'mod+alt+b'],
      ['Focus Binder', 'mod+shift+b'],
      ['Toggle Inspector', 'mod+alt+i'],
      ['Composition Mode', 'mod+alt+c'],
      ['Focus Mode', 'mod+alt+o'],
      ['Split Editor', 'mod+\\'],
      ['Light / Dark', 'mod+alt+t'],
    ],
  },
  {
    heading: 'Other',
    rows: [
      ['Command Palette', 'mod+k'],
      ['Writing Stats', ''],
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
      ['Autopilot', 'mod+shift+p'],
      ['Slop Proof', 'alt+p'],
      ['Prompt Registry', ''],
      ['Propagation Debt', ''],
      ['Foundation', ''],
      ['Best of N', ''],
      ['Critic', ''],
    ],
  },
]

interface Props { onClose: () => void }

export default function ShortcutsModal({ onClose }: Props): React.ReactElement {
  const platform = useShellStore((s) => s.platform)

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 780 }} role="dialog" aria-modal="true" aria-label="Keyboard Shortcuts">
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
