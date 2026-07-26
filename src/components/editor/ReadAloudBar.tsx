import React, { useEffect, useState } from 'react'
import { readAloud, isSpeechSupported, type ReadAloudState } from '../../lib/ReadAloud'
import Icon from '../common/Icon'

interface Props {
  onClose: () => void
}

/**
 * Transport controls for read-aloud proofing.
 *
 * Rate matters more than it looks: proofing by ear works best a little slower
 * than conversational, and the writer needs to be able to reach that without
 * leaving the page.
 */
export default function ReadAloudBar({ onClose }: Props): React.ReactElement {
  const [state, setState] = useState<ReadAloudState>(readAloud.getState())
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [rate, setRate] = useState(readAloud.getRate())

  useEffect(() => readAloud.subscribe(setState), [])

  useEffect(() => {
    let live = true
    void readAloud.whenVoicesReady().then((v) => { if (live) setVoices(v) })
    return () => { live = false }
  }, [])

  if (!isSpeechSupported()) {
    return (
      <div className="ra-bar">
        <span className="ra-note">This browser has no speech synthesis.</span>
        <span style={{ flex: 1 }} />
        <button className="ra-btn" onClick={onClose} aria-label="Close read-aloud">
          <Icon name="x" size={13} />
        </button>
      </div>
    )
  }

  const { speaking, paused, index, sentences } = state
  const total = sentences.length

  return (
    <div className="ra-bar">
      <button
        className="ra-btn primary"
        onClick={() => {
          if (!speaking) window.dispatchEvent(new Event('konbini:read-aloud-start'))
          else if (paused) readAloud.resume()
          else readAloud.pause()
        }}
        aria-label={!speaking ? 'Read aloud' : paused ? 'Resume' : 'Pause'}
        title={!speaking ? 'Read from the cursor' : paused ? 'Resume' : 'Pause'}
      >
        <Icon name={!speaking || paused ? 'audio-lines' : 'stop'} size={13} />
        <span>{!speaking ? 'Read' : paused ? 'Resume' : 'Pause'}</span>
      </button>

      {speaking && (
        <button className="ra-btn" onClick={() => readAloud.stop()} title="Stop" aria-label="Stop reading">
          <Icon name="stop" size={13} />
        </button>
      )}

      {speaking && total > 0 && (
        <span className="ra-pos">{Math.min(index + 1, total)} / {total}</span>
      )}

      <span style={{ flex: 1 }} />

      <label className="ra-rate" title="Reading speed">
        <input
          type="range" min={0.5} max={2} step={0.1} value={rate}
          onChange={(e) => {
            const r = Number(e.target.value)
            setRate(r)
            readAloud.setRate(r)
          }}
        />
        <span>{rate.toFixed(1)}×</span>
      </label>

      {voices.length > 0 && (
        <select
          className="ra-voice"
          value={readAloud.getVoiceURI() ?? ''}
          onChange={(e) => readAloud.setVoice(e.target.value || null)}
          title="Voice"
        >
          <option value="">Default voice</option>
          {voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
          ))}
        </select>
      )}

      <button className="ra-btn" onClick={onClose} aria-label="Close read-aloud" title="Close">
        <Icon name="x" size={13} />
      </button>
    </div>
  )
}
