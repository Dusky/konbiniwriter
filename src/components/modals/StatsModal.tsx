import React, { useState } from 'react'
import { statsService } from '../../lib/StatsService'

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
          <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
            {[
              { label: 'Today', value: todayWords.toLocaleString() + ' words' },
              { label: 'Streak', value: streak > 0 ? `🔥 ${streak}-day` : '—' },
              { label: 'All-time', value: allTime.toLocaleString() + ' words' },
            ].map(chip => (
              <div key={chip.label} style={{ flex: 1, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '12px 16px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{chip.label}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>{chip.value}</div>
              </div>
            ))}
          </div>

          {/* Daily goal */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, padding: '10px 14px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Daily goal</span>
            <input
              type="number"
              min={0}
              value={goal || ''}
              placeholder="none"
              onChange={(e) => commitGoal(e.target.value)}
              style={{ width: 90, padding: '5px 8px', borderRadius: 'var(--r-md)', border: '1px solid var(--border-2)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--mono)' }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>words / day</span>
            <span className="tb-spacer" style={{ flex: 1 }} />
            {goal > 0 && (
              <span style={{ fontSize: 12, color: goalMet ? 'var(--st-final)' : 'var(--text-3)' }}>
                {goalMet ? '✓ met today' : `${Math.round(Math.min(1, todayWords / goal) * 100)}% today`}
              </span>
            )}
          </div>

          {/* 30-day bar chart */}
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>Last 30 days</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 80, padding: '0 0 20px' }}>
            {history.map((d, i) => {
              const isToday = i === history.length - 1
              const height = d.words === 0 ? 2 : Math.max(4, Math.round((d.words / maxWords) * 72))
              return (
                <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div
                    title={`${d.date}: ${d.words.toLocaleString()} words`}
                    style={{
                      width: '100%', height,
                      background: d.words === 0 ? 'var(--border)' : 'var(--accent)',
                      opacity: isToday ? 1 : d.words === 0 ? 1 : 0.55,
                      borderRadius: 2,
                    }}
                  />
                  {isToday && (
                    <div style={{ fontSize: 9, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>today</div>
                  )}
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
