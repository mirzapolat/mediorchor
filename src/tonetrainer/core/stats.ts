import type { SessionRecord } from './types'

export type Range = 'day' | 'week' | 'month'

export interface Bucket {
  key: string
  label: string
  title: string
  minutes: number
  current: boolean
}

const DAY = 86_400_000

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function startOfWeek(d: Date) {
  const s = startOfDay(d)
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7))
  return s
}

function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY + 1) / 7)
}

/** Practice minutes for the last 14 days, 12 weeks or 12 months. */
export function practiceBuckets(sessions: SessionRecord[], range: Range, now = new Date()): Bucket[] {
  const buckets: (Bucket & { from: number; to: number })[] = []
  if (range === 'day') {
    for (let i = 13; i >= 0; i--) {
      const from = startOfDay(new Date(now.getTime() - i * DAY))
      const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1)
      buckets.push({
        key: from.toISOString(),
        label: from.toLocaleDateString('de-DE', { weekday: 'short' }).slice(0, 2),
        title: from.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }),
        minutes: 0,
        current: i === 0,
        from: from.getTime(),
        to: to.getTime(),
      })
    }
  } else if (range === 'week') {
    const thisWeek = startOfWeek(now)
    for (let i = 11; i >= 0; i--) {
      const from = new Date(thisWeek.getFullYear(), thisWeek.getMonth(), thisWeek.getDate() - i * 7)
      const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7)
      buckets.push({
        key: from.toISOString(),
        label: String(isoWeek(from)),
        title: `KW ${isoWeek(from)}, ab ${from.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}`,
        minutes: 0,
        current: i === 0,
        from: from.getTime(),
        to: to.getTime(),
      })
    }
  } else {
    for (let i = 11; i >= 0; i--) {
      const from = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const to = new Date(from.getFullYear(), from.getMonth() + 1, 1)
      buckets.push({
        key: from.toISOString(),
        label: from.toLocaleDateString('de-DE', { month: 'short' }).replace('.', '').slice(0, 3),
        title: from.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }),
        minutes: 0,
        current: i === 0,
        from: from.getTime(),
        to: to.getTime(),
      })
    }
  }
  for (const s of sessions) {
    const b = buckets.find((b) => s.startedAt >= b.from && s.startedAt < b.to)
    if (b) b.minutes += s.practiceSec / 60
  }
  return buckets.map(({ from: _f, to: _t, ...b }) => b)
}

/** Consecutive days with practice, counting back from today (or yesterday if today is still empty). */
export function streak(sessions: SessionRecord[], now = new Date()) {
  const days = new Set(sessions.map((s) => startOfDay(new Date(s.startedAt)).getTime()))
  let d = startOfDay(now)
  if (!days.has(d.getTime())) d = new Date(d.getTime() - DAY)
  let n = 0
  while (days.has(startOfDay(d).getTime())) {
    n++
    d = new Date(d.getTime() - DAY)
  }
  return n
}

export type TrendStatus = 'persistent' | 'improved' | 'declined' | 'solid' | 'mixed' | 'single'

export interface MeasureTrend {
  measureIndex: number
  label: string
  values: (number | null)[]
  latest: number | null
  status: TrendStatus
  /** Average deviation in cents across sessions (negative = flat). */
  bias: number | null
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

/** Per-measure accuracy across sessions, with a verdict on what keeps going wrong and what improved. */
export function measureTrends(sessions: SessionRecord[]): MeasureTrend[] {
  const indices = new Map<number, string>()
  for (const s of sessions) for (const [k, m] of Object.entries(s.measures)) indices.set(Number(k), m.label)
  return [...indices.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([mi, label]) => {
      const values = sessions.map((s) => {
        const m = s.measures[mi]
        return m && m.n ? m.score / m.n : null
      })
      const vs = values.filter((v): v is number => v !== null)
      const biases = sessions.flatMap((s) => (s.measures[mi]?.biasN ? [s.measures[mi].biasSum / s.measures[mi].biasN] : []))
      const latest = vs.length ? vs[vs.length - 1] : null
      let status: TrendStatus = 'single'
      if (vs.length >= 2) {
        const k = vs.length >= 4 ? 2 : 1
        const early = mean(vs.slice(0, k))
        const late = mean(vs.slice(-k))
        const weak = vs.filter((v) => v < 0.6).length
        if (late - early >= 0.2 && late >= 0.6) status = 'improved'
        else if (weak >= 2 && late < 0.6) status = 'persistent'
        else if (early - late >= 0.2) status = 'declined'
        else if (late >= 0.85) status = 'solid'
        else status = 'mixed'
      }
      return { measureIndex: mi, label, values, latest, status, bias: biases.length ? mean(biases) : null }
    })
}

export function formatMinutes(min: number) {
  if (min < 1) return min > 0 ? '< 1 Min.' : '0 Min.'
  if (min < 60) return `${Math.round(min)} Min.`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m ? `${h} Std. ${m} Min.` : `${h} Std.`
}
