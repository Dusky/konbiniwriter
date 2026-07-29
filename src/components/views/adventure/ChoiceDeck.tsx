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
  onChoose: (beat: string, endScene: boolean) => void
  onRegenerate: () => void
  onEndScene: () => void
  onSettings: (patch: { passageLength?: BeatLength; optionCount?: number; optionDetail?: OptionDetail; styleId?: string }) => void
}

/**
 * The deck of beats, and the author's own beat beside them.
 *
 * The free-text field is deliberately given the same weight as the cards. The
 * moment typing your own direction is harder than clicking a suggested one,
 * this stops being a writing tool and becomes a slot machine.
 */
export default function ChoiceDeck(props: Props): React.ReactElement {
  const { options, busy, opening, sceneWords, sceneBreakAfter } = props
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
  const chooseOwn = () => {
    const text = own.trim()
    // Opening the story needs no beat — the premise already said what it is.
    if ((!text && !opening) || busy) return
    setOwn('')
    props.onChoose(text, false)
  }

  // Number keys pick a beat, but never while the author is typing one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy || editing !== null) return
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
          {opening ? 'Open the story' : busy ? 'Writing…' : 'What happens next?'}
        </span>
        <div className="adv-deck-tools">
          <span className="adv-scene-words">
            {sceneWords} words
            {sceneWords < sceneBreakAfter && <span className="dimmed"> · scene break at {sceneBreakAfter}</span>}
          </span>
          <button className="btn sm" onClick={props.onEndScene} disabled={busy || opening} title="Start a new scene document">
            End scene
          </button>
          <button className="btn sm" onClick={props.onRegenerate} disabled={busy || opening} title="Ask for a different set of beats">
            <Icon name="refresh" size={12} /> Regenerate
          </button>
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

      {!opening && (
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
          placeholder={opening ? 'Or describe the opening moment yourself…' : 'Or write your own beat… (Enter to write it)'}
          onChange={(e) => setOwn(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chooseOwn() } }}
          aria-label="Write your own beat"
        />
        <button className="btn primary" onClick={chooseOwn} disabled={busy || (!own.trim() && !opening)}>
          {opening ? 'Begin' : 'Write it'}
        </button>
      </div>
    </div>
  )
}
