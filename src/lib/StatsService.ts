const KEY = 'konbini:stats:daily'

type DailyRecord = Record<string, number> // ISO date (YYYY-MM-DD) → words written

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

class StatsService {
  private load(): DailyRecord {
    try { return JSON.parse(window.api.prefs.get(KEY) ?? '{}') } catch { return {} }
  }
  private save(r: DailyRecord): void {
    window.api.prefs.set(KEY, JSON.stringify(r))
  }

  recordDelta(delta: number): void {
    if (delta <= 0) return
    const r = this.load()
    r[today()] = (r[today()] ?? 0) + delta
    this.save(r)
  }

  getHistory(days: number): { date: string; words: number }[] {
    const r = this.load()
    const result: { date: string; words: number }[] = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      result.push({ date: key, words: r[key] ?? 0 })
    }
    return result
  }

  getStreak(): number {
    const r = this.load()
    let streak = 0
    for (let i = 1; ; i++) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      if ((r[key] ?? 0) > 0) streak++
      else break
    }
    return streak
  }

  getAllTimeTotal(): number {
    return Object.values(this.load()).reduce((a, b) => a + b, 0)
  }
}

export const statsService = new StatsService()
