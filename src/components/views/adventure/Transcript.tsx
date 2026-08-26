import React, { useEffect, useRef } from 'react'
import Icon from '../../common/Icon'
import type { AdventureTurn, Intent } from '../../../lib/adventure'

interface Props {
  turns: AdventureTurn[]
  /** Prose still streaming for the turn at the end, shown as it arrives. */
  ghost: string
}

const LABEL: Record<Intent, string> = {
  continue: 'wrote',
  revise: 'revised',
  ask: 'answered',
}

const ICON: Record<Intent, 'sparkle' | 'edit' | 'info'> = {
  continue: 'sparkle',
  revise: 'edit',
  ask: 'info',
}

/**
 * The conversation, as a record of intent.
 *
 * The prose itself is in the manuscript beside this and the accepted beats are
 * in the spine document, so what this adds is the thing both of those throw
 * away: *what the author asked for*. "Make it quieter" never reaches the page,
 * but it is the most useful line in the session when you are three scenes on
 * and wondering why the register drifted.
 */
export default function Transcript({ turns, ghost }: Props): React.ReactElement {
  const endRef = useRef<HTMLDivElement | null>(null)

  // Follow the conversation down as it grows, the way a chat does.
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [turns.length, ghost])

  return (
    <div className="adv-script" aria-label="Conversation">
      <div className="adv-script-hd">Conversation</div>
      {turns.length === 0 && !ghost && (
        <p className="adv-script-empty">
          Say what happens next, ask for a change to what was just written, or ask
          a question about the story.
        </p>
      )}
      <div className="adv-script-list">
        {turns.map((t) => (
          <div key={t.id} className={`adv-turn${t.pending ? ' pending' : ''}`}>
            <div className="adv-turn-said">{t.said}</div>
            <div className="adv-turn-got">
              <span className={`adv-turn-tag ${t.intent}`}>
                <Icon name={ICON[t.intent]} size={11} />
                {t.pending ? 'thinking…' : t.proposed ? 'revision — review it in Changeset' : LABEL[t.intent]}
              </span>
              {t.got && <span className="adv-turn-body">{t.got}</span>}
            </div>
          </div>
        ))}
        {ghost && (
          <div className="adv-turn pending">
            <div className="adv-turn-got">
              <span className="adv-turn-tag continue"><Icon name="sparkle" size={11} /> writing…</span>
              <span className="adv-turn-body">{ghost}</span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  )
}
