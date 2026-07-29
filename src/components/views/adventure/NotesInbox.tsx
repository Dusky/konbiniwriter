import React from 'react'
import Icon from '../../common/Icon'
import type { NoteCandidate } from '../../../lib/adventure'

interface Props {
  notes: NoteCandidate[]
  scanning: boolean
  onFile: (note: NoteCandidate) => void
  onDismiss: (name: string) => void
  onFileAll: () => void
}

/**
 * What the assistant noticed the story just introduced.
 *
 * An inbox rather than an auto-file: the codex is the book's memory, and a
 * feature that writes to it unasked would quietly fill it with spear-carriers.
 * One click each, or all at once when the batch is obviously right.
 */
export default function NotesInbox({ notes, scanning, onFile, onDismiss, onFileAll }: Props): React.ReactElement {
  return (
    <aside className="adv-notes" aria-label="Story notes">
      <div className="adv-notes-hd">
        <span><Icon name="notebook" size={12} /> Noticed</span>
        {notes.length > 1 && <button className="btn sm" onClick={onFileAll}>File all</button>}
      </div>
      {scanning && notes.length === 0 && <div className="adv-notes-empty">Reading the passage…</div>}
      {!scanning && notes.length === 0 && (
        <div className="adv-notes-empty">
          New characters, places and facts land here as you write. Nothing is added to the Codex until you say so.
        </div>
      )}
      <div className="adv-notes-list">
        {notes.map((n) => (
          <div key={n.name} className="adv-note">
            <div className="adv-note-hd">
              <span className="adv-note-name">{n.name}</span>
              <span className="adv-note-cat">{n.category}</span>
            </div>
            {n.summary && <div className="adv-note-sum">{n.summary}</div>}
            {n.facts.length > 0 && (
              <div className="adv-note-facts">
                {n.facts.slice(0, 3).map((f, i) => (
                  <div key={i}><span>{f.label}</span> {f.value}</div>
                ))}
              </div>
            )}
            <div className="adv-note-act">
              <button className="btn sm primary" onClick={() => onFile(n)}>Add to Codex</button>
              <button className="btn sm" onClick={() => onDismiss(n.name)}>Dismiss</button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
