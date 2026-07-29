import React, { useState } from 'react'
import { statsService } from '../../lib/StatsService'
import { useProjectStore, subtreeWordCount } from '../../store/projectStore'
import { deadlineStatus, describeDeadline, makeDeadline, readDeadline, dayKey } from '../../lib/deadline'
import Icon from '../common/Icon'
import ModalShell from '../common/ModalShell'

interface Props { onClose: () => void; embedded?: boolean }

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export default function StatsModal({ onClose, embedded }: Props): React.ReactElement {
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

  // ── Deadline ───────────────────────────────────────────────────────────────
  const project = useProjectStore((s) => s.project)
  const updateProjectSettings = useProjectStore((s) => s.updateProjectSettings)
  const setProjectWordTarget = useProjectStore((s) => s.setProjectWordTarget)
  const totalWords = project
    ? project.rootIds.filter((id) => id !== project.trashId).reduce((a, id) => a + subtreeWordCount(project, id), 0)
    : 0
  const target = project?.settings.wordTarget ?? 0
  const deadline = project ? readDeadline(project.settings) : null
  const pace = deadline && target ? deadlineStatus(deadline, target, totalWords) : null

  // Re-anchoring on every change is deliberate: moving the date is making a new
  // promise, and pacing it from the old baseline would carry forward a debt the
  // author has just decided to renegotiate.
  const setDate = (date: string) => {
    if (!project) return
    updateProjectSettings({ deadline: date ? makeDeadline(date, totalWords, deadline?.writingDays) : undefined })
  }
  const toggleDay = (day: number) => {
    if (!project || !deadline) return
    const cur = deadline.writingDays ?? [0, 1, 2, 3, 4, 5, 6]
    const next = cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day].sort()
    updateProjectSettings({ deadline: { ...deadline, writingDays: next.length === 7 ? undefined : next } })
  }
  const writingDays = deadline?.writingDays ?? [0, 1, 2, 3, 4, 5, 6]

  return (
    <ModalShell embedded={embedded} onClose={onClose} maxWidth={520} label="Writing Stats">
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
                {goalMet ? <><Icon name="check" size={12} style={{ verticalAlign: '-1px', marginRight: 3 }} /> met today</> : `${Math.round(Math.min(1, todayWords / goal) * 100)}% today`}
              </span>
            )}
          </div>

          {/* Deadline */}
          {project && (
            <>
              <div className="stats-goal">
                <span className="stats-goal-lbl">Finish by</span>
                <input
                  className="inp mono"
                  style={{ width: 150 }}
                  type="date"
                  value={deadline?.date ?? ''}
                  min={dayKey(new Date())}
                  onChange={(e) => setDate(e.target.value)}
                  aria-label="Deadline date"
                />
                <input
                  className="inp mono"
                  style={{ width: 100 }}
                  type="number"
                  min={0}
                  value={target || ''}
                  placeholder="target"
                  onChange={(e) => {
                    const n = parseInt(e.target.value.replace(/[^0-9]/g, ''), 10)
                    setProjectWordTarget(isNaN(n) || n <= 0 ? undefined : n)
                  }}
                  aria-label="Word target"
                />
                <span style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}>words</span>
              </div>

              {deadline && !target && (
                <div className="stats-note">Set a word target above and this becomes a daily number.</div>
              )}

              {pace && (
                <div className={`stats-pace${pace.done ? ' done' : pace.overdue || pace.daysAhead < -0.5 ? ' behind' : ''}`}>
                  <div className="stats-pace-hd">
                    <b>{describeDeadline(pace)}</b>
                    {!pace.done && !pace.overdue && (
                      <span>{pace.daysLeft} writing day{pace.daysLeft === 1 ? '' : 's'} left · {pace.remaining.toLocaleString()} to go</span>
                    )}
                  </div>
                  {!pace.done && (
                    <>
                      {/* Two bars on one track: where you are, and where a steady
                          pace would have put you. The gap is the whole point. */}
                      <div className="stats-pace-track" title={`Expected by now: ${pace.expected.toLocaleString()} words`}>
                        <div className="stats-pace-fill" style={{ width: `${Math.min(100, (totalWords / target) * 100)}%` }} />
                        <div className="stats-pace-mark" style={{ left: `${Math.min(100, (pace.expected / target) * 100)}%` }} />
                      </div>
                      <div className="stats-pace-foot">
                        <span>{totalWords.toLocaleString()} written</span>
                        <span>{pace.originalPerDay.toLocaleString()}/day when set</span>
                        <span>{target.toLocaleString()}</span>
                      </div>
                    </>
                  )}
                  <div className="stats-pace-days">
                    <span>Writing days</span>
                    {DAY_LABELS.map((lbl, i) => (
                      <button
                        key={i}
                        className={`chip${writingDays.includes(i) ? ' on' : ''}`}
                        onClick={() => toggleDay(i)}
                        aria-pressed={writingDays.includes(i)}
                        title={`${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i]}`}
                      >{lbl}</button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

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
        {!embedded && (
          <div className="modal-foot">
            <span className="tb-spacer" />
            <button className="btn" onClick={onClose}>Done</button>
          </div>
        )}
    </ModalShell>
  )
}
