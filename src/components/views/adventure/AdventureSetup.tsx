import React, { useMemo, useState } from 'react'
import Icon from '../../common/Icon'
import { BEAT_LENGTHS, type BeatLength } from '../../../lib/beat'
import type { ID, Project } from '@shared/types'

export interface SetupChoice {
  mode: 'premise' | 'continue'
  premise: string
  /** Existing scene to continue from — 'continue' only. */
  sceneId: ID | null
  /** Folder new scenes go in — 'premise' only ('' = create one). */
  folderId: ID | null
  passageLength: BeatLength
}

interface Props {
  project: Project
  busy: boolean
  onStart: (choice: SetupChoice) => void
}

/**
 * Two doors in.
 *
 * "Continue from here" is the one that matters: pointed at a manuscript you
 * already started, adventure mode is a way to get unstuck in your own book,
 * using your own voice and cast. Starting from a premise is the empty-project
 * case, not the main one.
 */
export default function AdventureSetup({ project, busy, onStart }: Props): React.ReactElement {
  const written = useMemo(() => {
    const out: { id: ID; title: string; words: number }[] = []
    const walk = (ids: ID[]) => {
      for (const id of ids) {
        const n = project.nodes[id]
        if (!n) continue
        if (n.type !== 'folder') {
          const c = (project.docs[id]?.content ?? '').trim()
          if (c) out.push({ id, title: n.title, words: c.split(/\s+/).length })
        }
        walk(n.childIds)
      }
    }
    walk(project.rootIds.filter((id) => id !== project.trashId))
    return out
  }, [project])

  const folders = useMemo(() => {
    const out: { id: ID; title: string; depth: number }[] = []
    const walk = (ids: ID[], depth: number) => {
      for (const id of ids) {
        const n = project.nodes[id]
        if (!n || n.type !== 'folder' || id === project.trashId) continue
        out.push({ id, title: n.title, depth })
        walk(n.childIds, depth + 1)
      }
    }
    walk(project.rootIds.filter((id) => id !== project.trashId), 0)
    return out
  }, [project])

  const [mode, setMode] = useState<'premise' | 'continue'>(written.length ? 'continue' : 'premise')
  const [premise, setPremise] = useState('')
  const [sceneId, setSceneId] = useState<ID | null>(written[written.length - 1]?.id ?? null)
  const [folderId, setFolderId] = useState<ID | null>(folders[0]?.id ?? null)
  const [passageLength, setPassageLength] = useState<BeatLength>('paragraph')

  const canStart = mode === 'premise' ? premise.trim().length > 0 : !!sceneId

  return (
    <div className="adv-setup">
      <div className="adv-setup-hd">
        <h2>Adventure</h2>
        <p>
          You choose what happens next, one beat at a time; the assistant writes the prose.
          Everything lands in the binder as ordinary scenes, and every passage is snapshotted
          before it's added — so a beat you don't want costs one keystroke.
        </p>
      </div>

      <div className="seg adv-setup-mode">
        <button className={mode === 'continue' ? 'on' : ''} onClick={() => setMode('continue')} disabled={written.length === 0}>
          Continue from here
        </button>
        <button className={mode === 'premise' ? 'on' : ''} onClick={() => setMode('premise')}>
          Start from a premise
        </button>
      </div>

      {mode === 'continue' ? (
        <div className="adv-setup-body">
          {written.length === 0 ? (
            <div className="adv-setup-note">Nothing written yet — start from a premise instead.</div>
          ) : (
            <>
              <label className="adv-field">
                <span>Continue</span>
                <select value={sceneId ?? ''} onChange={(e) => setSceneId(e.target.value || null)}>
                  {written.map((w) => <option key={w.id} value={w.id}>{w.title} · {w.words} words</option>)}
                </select>
              </label>
              <div className="adv-setup-note">
                Your voice fingerprint, codex and the scenes around it come along. New scenes are
                created beside this one.
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="adv-setup-body">
          <label className="adv-field col">
            <span>What's the story?</span>
            <textarea
              value={premise}
              onChange={(e) => setPremise(e.target.value)}
              rows={5}
              placeholder="A ferryman on a river between the living and the dead starts finding letters in his boat, addressed to him, in his own handwriting…"
            />
          </label>
          <label className="adv-field">
            <span>Write into</span>
            <select value={folderId ?? ''} onChange={(e) => setFolderId(e.target.value || null)}>
              <option value="">Manuscript (create it)</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{' '.repeat(f.depth * 2)}{f.title}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <label className="adv-field">
        <span>Passage length</span>
        <select value={passageLength} onChange={(e) => setPassageLength(e.target.value as BeatLength)}>
          {BEAT_LENGTHS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </label>
      <div className="adv-setup-note">
        Shorter passages mean you steer more often. You can change this at any point.
      </div>

      <button
        className="btn primary adv-start"
        disabled={!canStart || busy}
        onClick={() => onStart({ mode, premise: premise.trim(), sceneId, folderId, passageLength })}
      >
        <Icon name="clapperboard" size={14} /> {busy ? 'Starting…' : mode === 'continue' ? 'Pick up from here' : 'Begin'}
      </button>
    </div>
  )
}
