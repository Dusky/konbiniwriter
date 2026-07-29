// Deadline arithmetic is the kind of code that is obviously correct and then
// tells a novelist they are 40,000 words behind on the day they set the goal.
// Every case here is one that would produce a wrong, discouraging number.

import { describe, it, expect } from 'vitest'
import {
  deadlineStatus, describeDeadline, makeDeadline, parseDay, dayKey,
  writingDaysBetween, readDeadline, type Deadline,
} from './deadline'

const D = (s: string) => parseDay(s) as Date
const deadline = (patch: Partial<Deadline> = {}): Deadline =>
  ({ date: '2026-11-01', startedOn: '2026-10-01', startWords: 0, ...patch })

describe('parseDay / dayKey', () => {
  it('reads a date in local time, not UTC', () => {
    // `new Date('2026-11-01')` is UTC midnight, which is Oct 31 in the Americas
    // — an off-by-one on every deadline west of Greenwich.
    const d = D('2026-11-01')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(10)
    expect(d.getDate()).toBe(1)
  })
  it('round-trips through dayKey', () => {
    expect(dayKey(D('2026-03-09'))).toBe('2026-03-09')
  })
  it('refuses anything that is not YYYY-MM-DD', () => {
    expect(parseDay('11/01/2026')).toBeNull()
    expect(parseDay('')).toBeNull()
    expect(parseDay('2026-13-45')).not.toBeNull() // JS rolls over; not our job to reject
  })
})

describe('writingDaysBetween', () => {
  it('counts both ends', () => {
    expect(writingDaysBetween(D('2026-10-01'), D('2026-10-01'))).toBe(1)
    expect(writingDaysBetween(D('2026-10-01'), D('2026-10-03'))).toBe(3)
  })
  it('is zero when the end is already past', () => {
    expect(writingDaysBetween(D('2026-10-05'), D('2026-10-01'))).toBe(0)
  })
  it('counts only the days you actually write', () => {
    // Oct 1 2026 is a Thursday. Sat+Sun in that week: Oct 3, 4.
    expect(writingDaysBetween(D('2026-10-01'), D('2026-10-07'), [0, 6])).toBe(2)
  })
  it('treats an empty writing-days list as every day', () => {
    expect(writingDaysBetween(D('2026-10-01'), D('2026-10-07'), [])).toBe(7)
  })
})

describe('deadlineStatus', () => {
  it('turns a target and a date into a daily number', () => {
    // Oct 1 → Nov 1 inclusive is 32 days; 50,000 words → 1,563/day.
    const s = deadlineStatus(deadline(), 50_000, 0, D('2026-10-01'))!
    expect(s.totalDays).toBe(32)
    expect(s.daysLeft).toBe(32)
    expect(s.perDay).toBe(1563)
    expect(s.originalPerDay).toBe(1563)
  })

  it('does not call you behind on the day you set the deadline', () => {
    // The whole reason a deadline stores startWords: someone 40k into a book
    // who commits to 90k by Nov 1 is on pace, not 40k behind.
    const s = deadlineStatus(deadline({ startWords: 40_000 }), 90_000, 40_000, D('2026-10-01'))!
    expect(s.aheadBy).toBe(0)
    expect(s.daysAhead).toBe(0)
    expect(s.perDay).toBe(1563)
  })

  it('measures behind-ness in days at the original pace', () => {
    // 10 days spent of 32, so a steady pace expects 15,625 words. At 10,937
    // the author is ~4,688 short — three days at 1,563/day.
    const s = deadlineStatus(deadline(), 50_000, 10_937, D('2026-10-11'))!
    expect(s.expected).toBe(15_625)
    expect(s.aheadBy).toBe(-4_688)
    expect(s.daysAhead).toBe(-3)
    expect(describeDeadline(s)).toContain('3 days behind')
  })

  it('recomputes the daily number from where you actually are', () => {
    const s = deadlineStatus(deadline(), 50_000, 10_937, D('2026-10-11'))!
    expect(s.daysLeft).toBe(22)
    expect(s.perDay).toBe(Math.ceil((50_000 - 10_937) / 22))
    expect(s.perDay).toBeGreaterThan(s.originalPerDay) // catching up costs more
  })

  it('reports being ahead', () => {
    const s = deadlineStatus(deadline(), 50_000, 25_000, D('2026-10-11'))!
    expect(s.aheadBy).toBeGreaterThan(0)
    expect(describeDeadline(s)).toContain('ahead')
  })

  it('says "on pace" rather than "0.2 days ahead"', () => {
    const s = deadlineStatus(deadline(), 50_000, 15_800, D('2026-10-11'))!
    expect(describeDeadline(s)).toContain('on pace')
  })

  it('never divides by zero on the last day', () => {
    const s = deadlineStatus(deadline(), 50_000, 49_000, D('2026-11-01'))!
    expect(s.daysLeft).toBe(1)
    expect(s.perDay).toBe(1000)
    expect(Number.isFinite(s.perDay)).toBe(true)
  })

  it('asks for the whole remainder once the days have run out', () => {
    const s = deadlineStatus(deadline(), 50_000, 49_000, D('2026-11-02'))!
    expect(s.daysLeft).toBe(0)
    expect(s.perDay).toBe(1000)
    expect(s.overdue).toBe(true)
    expect(describeDeadline(s)).toBe('1,000 words past deadline')
  })

  it('knows when the book is finished, even late', () => {
    const s = deadlineStatus(deadline(), 50_000, 50_000, D('2026-12-01'))!
    expect(s.done).toBe(true)
    expect(s.overdue).toBe(false)
    expect(s.perDay).toBe(0)
    expect(describeDeadline(s)).toBe('Target reached')
  })

  it('paces against writing days, not calendar days', () => {
    // Weekends only: 10 Sat/Sun between Oct 1 and Nov 1 2026.
    const s = deadlineStatus(deadline({ writingDays: [0, 6] }), 50_000, 0, D('2026-10-01'))!
    expect(s.totalDays).toBe(10)
    expect(s.perDay).toBe(5000)
  })

  it('refuses to report on a deadline that cannot say anything', () => {
    expect(deadlineStatus(deadline(), 0, 0)).toBeNull()
    expect(deadlineStatus(deadline({ date: 'soon' }), 50_000, 0)).toBeNull()
    // Target already at or below where you started: nothing to pace.
    expect(deadlineStatus(deadline({ startWords: 50_000 }), 50_000, 0)).toBeNull()
  })
})

describe('makeDeadline', () => {
  it('anchors to today and the current word count', () => {
    const d = makeDeadline('2026-11-01', 12_000, undefined, D('2026-10-05'))
    expect(d).toEqual({ date: '2026-11-01', startedOn: '2026-10-05', startWords: 12_000 })
  })
  it('only stores writing days when some were chosen', () => {
    expect(makeDeadline('2026-11-01', 0, [], D('2026-10-05')).writingDays).toBeUndefined()
    expect(makeDeadline('2026-11-01', 0, [1, 2], D('2026-10-05')).writingDays).toEqual([1, 2])
  })
})

describe('readDeadline', () => {
  it('reads a stored deadline', () => {
    expect(readDeadline({ deadline: deadline({ startWords: 5 }) })?.startWords).toBe(5)
  })
  it('rejects a malformed one instead of showing nonsense', () => {
    expect(readDeadline({})).toBeNull()
    expect(readDeadline({ deadline: { date: '2026-11-01' } })).toBeNull()
    expect(readDeadline({ deadline: 'nov 1' })).toBeNull()
  })
  it('tolerates a missing word baseline from an older bundle', () => {
    expect(readDeadline({ deadline: { date: '2026-11-01', startedOn: '2026-10-01' } })?.startWords).toBe(0)
  })
})
