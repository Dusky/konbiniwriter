import React, { useState } from 'react'
import { statsService } from '../../lib/StatsService'
import Icon from '../common/Icon'

interface Props { onClose: () => void }

export default function StatsModal({ onClose }: Props): React.ReactElement {
  const history = statsService.getHistory(30)
  const streak = statsService.getStreak()
  const allTime = statsService.getAllTimeTotal()
  const todayWords = history[history.length - 1]?.words ?? 0
  const maxWords = Math.max(...history.map(d => d.words), 1)

  const [goal, setGoal] = useState(statsService.getDailyGoal())
  const goalMet = goal > 0 && todayWords >= goal
  const commitGoal = (v: string) => {
    const n = parseInt(v.replace(/[^0-9]/g, ''), 10)
    const resolved = isNaN(n) ? 0 : n
    statsService.setDailyGoal(resolved)
    setGoal(resolved)
  }

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }} role="dialog" aria-modal="true" aria-label="Writing Stats">
        <div className="modal-hd">
          <h3>Writing Stats</h3>
        </div>
        <div className="modal-body">
          {/* Stat chips */}
          <div className="stats-chips">
            {[
              { label: 'Today', value: todayWords.toLocaleString() + ' words' },
              { label: 'Streak', value: streak > 0
                ? <><Icon name="flame" size={13} style={{ color: 'var(--warn)', verticalAlign: '-2px' }} /> {streak}-day</>
                : '—' },
              { label: 'All-time', value: allTime.toLocaleString() + ' words' },
            ].map((chip: { label: string; value: React.ReactNode }) => (
              <div key={chip.label} className="stats-chip">
                <div className="stats-chip-l">{chip.label}</div>
                <div className="stats-chip-v">{chip.value}</div>
              </div>
            ))}
          </div>

          {/* Daily goal */}
          <div className="stats-goal">
            <span className="stats-goal-lbl">Daily goal</span>
            <input
              className="inp mono"
              style={{ width: 90 }}
              type="number"
              min={0}
              value={goal || ''}
              placeholder="none"
              onChange={(e) => commitGoal(e.target.value)}
            />
            <span style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}>words / day</span>
            <span className="tb-spacer" style={{ flex: 1 }} />
            {goal > 0 && (
              <span style={{ fontSize: 'var(--t-sm)', color: goalMet ? 'var(--st-final)' : 'var(--text-3)' }}>
                {goalMet ? '✓ met today' : `${Math.round(Math.min(1, todayWords / goal) * 100)}% today`}
              </span>
            )}
          </div>

          {/* 30-day bar chart */}
          <div className="stats-chart-lbl">Last 30 days</div>
          <div className="stats-chart">
            {history.map((d, i) => {
              const isToday = i === history.length - 1
              const height = d.words === 0 ? 2 : Math.max(4, Math.round((d.words / maxWords) * 72))
              return (
                <div key={d.date} className="stats-bar-col">
                  <div
                    className={`stats-bar${d.words === 0 ? ' empty' : !isToday ? ' dim' : ''}`}
                    title={`${d.date}: ${d.words.toLocaleString()} words`}
                    style={{ height }}
                  />
                  {isToday && <div className="stats-today">today</div>}
                </div>
              )
            })}
          </div>
        </div>
        <div className="modal-foot">
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
