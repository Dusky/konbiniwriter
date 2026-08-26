import React, { useEffect, useRef, useState } from 'react'
import Icon from '../../common/Icon'
import { BEAT_LENGTHS, BEAT_STYLES, type BeatLength } from '../../../lib/beat'
import { MAX_OPTIONS, MIN_OPTIONS, type AdventureOption, type OptionDetail } from '../../../lib/adventure'

interface Props {
  options: AdventureOption[]
  busy: boolean
  /** Nothing has been written yet — the deck is the opening control. */
  opening: boolean
  length: BeatLength
  optionCount: number
  detail: OptionDetail
  styleId: string
  sceneWords: number
  sceneBreakAfter: number
  deckOpen: boolean
  onChoose: (beat: string, endScene: boolean) => void
  /** Free text — routed by intent rather than assumed to be a beat. */
  onSay: (text: string) => void
  /** Carry on from where the text stops, with no direction given. */
  onContinue: () => void
  /** Stand the model down; the author writes this passage themselves. */
  onHandOff: () => void
  onToggleDeck: () => void
  onRegenerate: () => void
  onEndScene: () => void
  onSettings: (patch: { passageLength?: BeatLength; optionCount?: number; optionDetail?: OptionDetail; styleId?: string }) => void
}

/**
 * The conversation, and the deck of suggested beats above it.
 *
 * The free-text field is deliberately given the same weight as the cards. The
 * moment typing your own direction is harder than clicking a suggested one,
 * this stops being a writing tool and becomes a slot machine — which is also
 * why the deck collapses: when you know what happens next, a menu of things
 * that could happen instead is noise.
 *
 * Cards go straight out as beats. Free text is classified first, because a line
 * like "that's too flowery" is an instruction about the last passage, not the
 * next one.
 */
export default function ChoiceDeck(props: Props): React.ReactElement {
  const { options, busy, opening, sceneWords, sceneBreakAfter, deckOpen } = props
  const [own, setOwn] = useState('')
  const [edits, setEdits] = useState<Record<number, string>>({})
  const [editing, setEditing] = useState<number | null>(null)
  const [showOpts, setShowOpts] = useState(false)
  const ownRef = useRef<HTMLTextAreaElement | null>(null)

  // A new deck invalidates any half-finished edit of the old one.
  useEffect(() => { setEdits({}); setEditing(null) }, [options])

  const textOf = (i: number) => edits[i] ?? options[i]?.text ?? ''
  const choose = (i: number) => {
    const text = textOf(i).trim()
    if (!text || busy) return
    props.onChoose(text, options[i]?.endScene === true)
  }
  const say = () => {
    const text = own.trim()
    // Opening the story needs no beat — the premise already said what it is.
    if ((!text && !opening) || busy) return
    setOwn('')
    // The opening has nothing written yet, so there is nothing to revise or ask
    // about: it goes straight out as the first beat.
    if (opening) props.onChoose(text, false)
    else props.onSay(text)
  }

  // Number keys pick a beat, but never while the author is typing one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy || editing !== null || !deckOpen) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const n = parseInt(e.key, 10)
      if (Number.isInteger(n) && n >= 1 && n <= options.length) { e.preventDefault(); choose(n - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="adv-deck">
      <div className="adv-deck-hd">
        <span className="adv-deck-title">
          {opening ? 'Open the story' : busy ? 'Working…' : 'What happens next?'}
        </span>
        <div className="adv-deck-tools">
          <span className="adv-scene-words">
            {sceneWords} words
            {sceneWords < sceneBreakAfter && <span className="dimmed"> · scene break at {sceneBreakAfter}</span>}
          </span>
          <button className="btn sm" onClick={props.onHandOff} disabled={busy || opening} title="Put the cursor in the manuscript — you write this one">
            I'll write this one
          </button>
          <button className="btn sm" onClick={props.onContinue} disabled={busy || opening} title="Carry on from where the text stops, with no direction">
            Continue
          </button>
          <button className="btn sm" onClick={props.onEndScene} disabled={busy || opening} title="Start a new scene document">
            End scene
          </button>
          <button
            className={`btn sm${deckOpen ? ' on' : ''}`}
            onClick={props.onToggleDeck}
            disabled={opening}
            aria-expanded={deckOpen}
            title={deckOpen ? 'Hide the suggested beats' : 'Show suggested beats'}
          >
            Beats
          </button>
          {deckOpen && (
            <button className="btn sm" onClick={props.onRegenerate} disabled={busy || opening} title="Ask for a different set of beats">
              <Icon name="refresh" size={12} /> Regenerate
            </button>
          )}
          <button className={`btn sm${showOpts ? ' on' : ''}`} onClick={() => setShowOpts((v) => !v)} title="Session settings" aria-expanded={showOpts}>
            <Icon name="settings" size={12} />
          </button>
        </div>
      </div>

      {showOpts && (
        <div className="adv-opts">
          <label>
            <span>Passage</span>
            <select value={props.length} onChange={(e) => props.onSettings({ passageLength: e.target.value as BeatLength })}>
              {BEAT_LENGTHS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </label>
          <label>
            <span>Beats</span>
            <select value={props.optionCount} onChange={(e) => props.onSettings({ optionCount: parseInt(e.target.value, 10) })}>
              {Array.from({ length: MAX_OPTIONS - MIN_OPTIONS + 1 }, (_, i) => MIN_OPTIONS + i).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Detail</span>
            <select value={props.detail} onChange={(e) => props.onSettings({ optionDetail: e.target.value as OptionDetail })}>
              <option value="terse">Terse</option>
              <option value="detailed">Detailed</option>
            </select>
          </label>
          <label>
            <span>Style</span>
            <select value={props.styleId} onChange={(e) => props.onSettings({ styleId: e.target.value })}>
              {BEAT_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        </div>
      )}

      {!opening && deckOpen && (
        <div className="adv-cards">
          {options.length === 0 && !busy && (
            <div className="adv-empty-deck">No beats yet — regenerate, or write your own below.</div>
          )}
          {options.map((o, i) => (
            <div key={i} className={`adv-card${o.endScene ? ' end' : ''}`}>
              <button className="adv-card-num" onClick={() => choose(i)} disabled={busy} title={`Choose beat ${i + 1}`}>
                {i + 1}
              </button>
              <textarea
                className="adv-card-text"
                value={textOf(i)}
                rows={2}
                disabled={busy}
                onFocus={() => setEditing(i)}
                onBlur={() => setEditing(null)}
                onChange={(e) => setEdits((p) => ({ ...p, [i]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); choose(i) } }}
                aria-label={`Beat ${i + 1}`}
              />
              {o.endScene && <span className="adv-card-tag">ends scene</span>}
            </div>
          ))}
        </div>
      )}

      <div className="adv-own">
        <textarea
          ref={ownRef}
          value={own}
          rows={2}
          disabled={busy}
          placeholder={opening
            ? 'Or describe the opening moment yourself…'
            : 'What happens next? Or ask for a change, or a question… (Enter to send)'}
          onChange={(e) => setOwn(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); say() } }}
          aria-label={opening ? 'Describe the opening' : 'Say what happens next, or ask for a change'}
        />
        <button className="btn primary" onClick={say} disabled={busy || (!own.trim() && !opening)}>
          {opening ? 'Begin' : 'Send'}
        </button>
      </div>
    </div>
  )
}
