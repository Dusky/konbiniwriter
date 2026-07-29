// deadline.ts — "finish by Nov 1" turned into a daily number and an honest
// answer to "am I behind?".
//
// The arithmetic is trivial; the part worth thinking about is the baseline.
// Pacing from the project's creation date is wrong for anyone who sets a
// deadline mid-book — it would announce you were 40,000 words behind on the day
// you set it. So a deadline records where you were when you made the promise,
// and progress is measured from there.
//
// Pure: no store, no I/O, no DOM.

/** A promise the author made, and the state of the book when they made it. */
export interface Deadline {
  /** Target date, `YYYY-MM-DD` in the author's own calendar. */
  date: string
  /** The day the deadline was set. */
  startedOn: string
  /** Project word count at that moment — the baseline progress is measured from. */
  startWords: number
  /** Days of the week the author actually writes; empty = every day. 0 = Sunday. */
  writingDays?: number[]
}

export interface DeadlineStatus {
  /** Writing days remaining, counting today. 0 means it is due today or past. */
  daysLeft: number
  /** Writing days in the whole run. */
  totalDays: number
  /** Words still to write. */
  remaining: number
  /** Words per remaining day needed from today on. */
  perDay: number
  /** Words per day the promise implied on day one. */
  originalPerDay: number
  /** Where a steady pace would have put you by now. */
  expected: number
  /** Words ahead of that pace; negative means behind. */
  aheadBy: number
  /** The same in days, at the original pace. Negative means behind. */
  daysAhead: number
  done: boolean
  /** Past the date, target not met. */
  overdue: boolean
}

/** Parse `YYYY-MM-DD` in local time. `new Date(s)` would read it as UTC. */
export function parseDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/** `YYYY-MM-DD` for a Date, in local time. */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Days you would actually write between two dates, `from` inclusive and `to`
 * inclusive.
 *
 * Counting calendar days would quietly overstate the runway for someone who
 * only writes weekends — the number that matters is sessions, not sunrises.
 */
export function writingDaysBetween(from: Date, to: Date, writingDays?: number[]): number {
  if (to < from) return 0
  const allowed = writingDays && writingDays.length > 0 ? new Set(writingDays) : null
  let count = 0
  const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  while (cur <= end) {
    if (!allowed || allowed.has(cur.getDay())) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

/**
 * Where the book stands against the promise.
 *
 * Returns null when the deadline can't say anything useful — no target, an
 * unparseable date, or a target already at or below the baseline.
 */
export function deadlineStatus(
  deadline: Deadline,
  target: number,
  current: number,
  now: Date = new Date(),
): DeadlineStatus | null {
  const end = parseDay(deadline.date)
  const start = parseDay(deadline.startedOn)
  if (!end || !start || !target || target <= deadline.startWords) return null

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const words = target - deadline.startWords
  const totalDays = writingDaysBetween(start, end, deadline.writingDays)
  const daysLeft = writingDaysBetween(today, end, deadline.writingDays)
  const remaining = Math.max(0, target - current)
  const done = current >= target
  const overdue = !done && today > end

  const originalPerDay = totalDays > 0 ? Math.ceil(words / totalDays) : words
  // With no days left, the honest number is "all of it", not a division by zero.
  const perDay = done ? 0 : daysLeft > 0 ? Math.ceil(remaining / daysLeft) : remaining

  // Steady pace: days already spent, out of the whole run.
  const spent = Math.max(0, totalDays - daysLeft)
  const expected = totalDays > 0
    ? Math.round(deadline.startWords + (words * Math.min(spent, totalDays)) / totalDays)
    : target
  const aheadBy = current - expected
  const daysAhead = originalPerDay > 0 ? Math.round((aheadBy / originalPerDay) * 10) / 10 : 0

  return { daysLeft, totalDays, remaining, perDay, originalPerDay, expected, aheadBy, daysAhead, done, overdue }
}

/** One line for the status bar. Deliberately blunt — this is a nudge, not a report. */
export function describeDeadline(s: DeadlineStatus): string {
  if (s.done) return 'Target reached'
  if (s.overdue) return `${s.remaining.toLocaleString()} words past deadline`
  const pace = `${s.perDay.toLocaleString()}/day`
  if (Math.abs(s.daysAhead) < 0.5) return `${pace} · on pace`
  const n = Math.abs(s.daysAhead)
  const days = `${n % 1 === 0 ? n : n.toFixed(1)} day${n === 1 ? '' : 's'}`
  return `${pace} · ${s.daysAhead > 0 ? `${days} ahead` : `${days} behind`}`
}

/** A fresh deadline anchored to today and the current word count. */
export function makeDeadline(date: string, startWords: number, writingDays?: number[], now: Date = new Date()): Deadline {
  return { date, startedOn: dayKey(now), startWords, ...(writingDays?.length ? { writingDays } : {}) }
}

/** Deadlines are stored on project settings; this is the read side. */
export function readDeadline(settings: { deadline?: unknown }): Deadline | null {
  const d = settings.deadline as Deadline | undefined
  if (!d || typeof d.date !== 'string' || typeof d.startedOn !== 'string') return null
  return { ...d, startWords: Number(d.startWords) || 0 }
}
