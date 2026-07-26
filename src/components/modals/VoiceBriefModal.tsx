import React, { useEffect, useRef, useState } from 'react'
import Icon from '../common/Icon'
import { generateVoiceFingerprint } from '../../lib/voice'

interface Props {
  /** Seeded into the editor so a regenerate can start from what's there. */
  initial?: string
  /** Called with the fingerprint the author accepted. */
  onSave: (fingerprint: string) => void
  onClose: () => void
}

const EXAMPLES = [
  'Literary noir. Close third on a tired detective. Short declaratives, almost no adverbs. Weather does the emotional work.',
  'Warm, wry, present tense, first person. Long sentences that circle back on themselves. Dialogue carries the plot.',
  'Cold far-future SF. Third person, past tense, clinical diction. Technical nouns used without explanation. No similes.',
]

/**
 * Author a voice fingerprint from a description.
 *
 * The two existing routes to a fingerprint both need prose that already exists —
 * Foundation derives one from the concept, AI Settings re-derives from the
 * manuscript. Neither helps at the point a writer most wants to fix their voice:
 * before chapter one, when all they have is an intention. This is that route.
 */
export default function VoiceBriefModal({ initial = '', onSave, onClose }: Props): React.ReactElement {
  const [brief, setBrief] = useState('')
  const [reference, setReference] = useState('')
  const [showReference, setShowReference] = useState(false)
  const [draft, setDraft] = useState(initial)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const briefRef = useRef<HTMLTextAreaElement>(null)

  // Streaming components must abort on unmount, or a closed modal keeps
  // spending tokens and then calls setState on a dead component.
  useEffect(() => () => abortRef.current?.abort(), [])
  useEffect(() => { briefRef.current?.focus() }, [])

  const run = async () => {
    if (running || !brief.trim()) return
    setRunning(true)
    setError(null)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const result = await generateVoiceFingerprint(
        { from: 'brief', brief: brief.trim(), reference: showReference ? reference.trim() : '' },
        setDraft,
        controller.signal,
      )
      setDraft(result)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const stop = () => { abortRef.current?.abort(); setRunning(false) }

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal vb-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Describe a voice"
        onKeyDown={(e) => {
          // ⌘⏎ from anywhere in the dialog generates — the field you're typing
          // the brief into is the field you want to submit from.
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void run() }
        }}
      >
        <div className="modal-hd">
          <h3>Describe a voice</h3>
          <span className="vb-sub">
            Say how the prose should sound and Konbini writes the style guide. It goes into every AI call,
            and the voice-drift scorer measures your scenes against it.
          </span>
        </div>

        <div className="modal-body vb-body">
          <label className="vb-label" htmlFor="vb-brief">The voice you want</label>
          <textarea
            id="vb-brief"
            ref={briefRef}
            className="ta"
            rows={4}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="POV, tense, rhythm, register, what to avoid — a sentence or a paragraph, whatever you have."
          />

          <div className="vb-examples">
            <span className="vb-examples-hd">Try:</span>
            {EXAMPLES.map((ex, i) => (
              <button key={i} className="kw-sugg-item" type="button" onClick={() => setBrief(ex)} title={ex}>
                {ex.split('.')[0]}
              </button>
            ))}
          </div>

          {showReference ? (
            <>
              <label className="vb-label" htmlFor="vb-ref">
                Prose to emulate <span className="vb-optional">optional</span>
              </label>
              <textarea
                id="vb-ref"
                className="ta"
                rows={4}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Paste a passage whose voice you're aiming at — yours or someone else's."
              />
            </>
          ) : (
            <button className="btn sm vb-add-ref" type="button" onClick={() => setShowReference(true)}>
              <Icon name="plus" size={12} /> Add a passage to emulate
            </button>
          )}

          <div className="vb-actions">
            {running ? (
              <button className="btn sm" onClick={stop}>Stop</button>
            ) : (
              <button className="btn sm primary" disabled={!brief.trim()} onClick={() => void run()}>
                {draft.trim() ? 'Regenerate' : 'Generate'}
              </button>
            )}
            {error && <span className="vb-error">{error}</span>}
          </div>

          <label className="vb-label" htmlFor="vb-draft">
            Style guide {draft.trim() && <span className="vb-optional">editable</span>}
          </label>
          <textarea
            id="vb-draft"
            className="ta mono"
            rows={12}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="The generated style guide appears here. Edit it freely — it's yours."
          />
        </div>

        <div className="modal-foot">
          <span className="hint">Saved to this project. Replaces the current fingerprint.</span>
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={!draft.trim() || running}
            onClick={() => { onSave(draft.trim()); onClose() }}
          >
            Save fingerprint
          </button>
        </div>
      </div>
    </div>
  )
}
