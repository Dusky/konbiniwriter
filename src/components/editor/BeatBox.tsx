import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import { streamBeat, BEAT_LENGTHS, BEAT_STYLES, type BeatLength } from '../../lib/beat'
import { kbd } from '../../lib/kbd'
import Icon from '../common/Icon'

interface Props {
  docId: string
  preceding: string
  anchorRect: DOMRect
  onClose: () => void
  /** Host inserts the accepted prose (as a reviewable proposal) at the cursor. */
  onInsert: (text: string, description: string) => void
}

const PK = { length: 'pref:beatLength', style: 'pref:beatStyle', styleText: 'pref:beatStyleText', model: 'pref:beatModel' }

export default function BeatBox({ docId, preceding, anchorRect, onClose, onInsert }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const mentionIndex = useProjectStore((s) => s.mentionIndex)
  const { enabled, savedModels, provider, anthropicModel, openaiModel } = useAIStore()
  const activeModel = provider === 'anthropic' ? anthropicModel : openaiModel
  const modelOptions = savedModels.length ? savedModels : [activeModel].filter(Boolean)

  const [description, setDescription] = useState('')
  const [length, setLength] = useState<BeatLength>(() => (window.api.prefs.get(PK.length) as BeatLength) || 'paragraph')
  const [styleId, setStyleId] = useState<string>(() => window.api.prefs.get(PK.style) || 'voice')
  const [styleText, setStyleText] = useState<string>(() => window.api.prefs.get(PK.styleText) || '')
  const [model, setModel] = useState<string>(() => {
    const saved = window.api.prefs.get(PK.model) || ''
    return modelOptions.includes(saved) ? saved : (modelOptions[0] ?? activeModel)
  })

  const [phase, setPhase] = useState<'idle' | 'streaming' | 'done'>('idle')
  const [preview, setPreview] = useState('')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { descRef.current?.focus() }, [])
  useEffect(() => () => abortRef.current?.abort(), [])

  const persist = () => {
    window.api.prefs.set(PK.length, length)
    window.api.prefs.set(PK.style, styleId)
    window.api.prefs.set(PK.styleText, styleText)
    window.api.prefs.set(PK.model, model)
  }

  const generate = useCallback(async () => {
    if (!project || !description.trim()) return
    persist()
    setError(null)
    setPhase('streaming')
    setPreview('')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const full = await streamBeat({
        project, mentionIndex, docId, preceding, description,
        length, styleId, styleText, model: model || undefined,
        signal: controller.signal,
        onChunk: (partial) => setPreview(partial),
      })
      setPreview(full.trim())
      setPhase('done')
    } catch (err) {
      if ((err as Error).name === 'AbortError') { setPhase(preview ? 'done' : 'idle'); return }
      setError((err as Error).message)
      setPhase('idle')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, mentionIndex, docId, preceding, description, length, styleId, styleText, model])

  const stop = () => { abortRef.current?.abort() }
  const accept = () => { if (preview.trim()) { persist(); onInsert(preview.trim(), description) } }

  if (!enabled) return <></>

  // Position below the cursor, clamped to the viewport.
  const width = 380
  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - width - 8))
  const top = Math.min(anchorRect.bottom + 8, window.innerHeight - 320)

  return (
    <>
      <div className="beat-scrim" onMouseDown={onClose} />
      <div className="beat-box" style={{ top, left, width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="beat-hd">
          <span className="ai-spark"><Icon name="sparkle" size={13} /></span> Generate beat
          <span style={{ flex: 1 }} />
          <button className="beat-x" onClick={onClose} aria-label="Close"><Icon name="x" size={13} /></button>
        </div>

        <textarea
          ref={descRef}
          className="beat-desc"
          placeholder="What happens next? e.g. Reiko follows the sound into the ninth aisle and finds the bento."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); generate() } }}
          rows={3}
        />

        <div className="beat-controls">
          <select className="beat-sel" value={length} onChange={(e) => setLength(e.target.value as BeatLength)} title="Length">
            {BEAT_LENGTHS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <select className="beat-sel" value={styleId} onChange={(e) => setStyleId(e.target.value)} title="Style">
            {BEAT_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select className="beat-sel" value={model} onChange={(e) => setModel(e.target.value)} title="Model">
            {modelOptions.length === 0 && <option value="">(set a model)</option>}
            {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <input
          className="beat-style-text"
          placeholder="extra style notes (optional)"
          value={styleText}
          onChange={(e) => setStyleText(e.target.value)}
        />

        {error && <div className="beat-err">{error}</div>}

        {(phase !== 'idle' || preview) && (
          <div className="beat-preview">{preview || <em>Writing…</em>}</div>
        )}

        <div className="beat-foot">
          {phase === 'streaming' ? (
            <button className="btn" onClick={stop}>Stop</button>
          ) : phase === 'done' ? (
            <>
              <button className="btn primary" onClick={accept}>Insert</button>
              <button className="btn" onClick={generate}>Regenerate</button>
              <span style={{ flex: 1 }} />
              <button className="btn ghost" onClick={onClose}>Discard</button>
            </>
          ) : (
            <>
              <button className="btn primary" disabled={!description.trim() || !model} onClick={generate}>
                Generate <span style={{ opacity: 0.7, marginLeft: 4 }}>{kbd('mod+enter')}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}
