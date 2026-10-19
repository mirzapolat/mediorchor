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
export function measureTrends(sessions: SessionRecord[], piece?: PieceMeasures): MeasureTrend[] {
  const indices = new Map<number, string>()
  // Every measure of the piece (unsung ones too), else those sung.
  if (piece) for (const [k, m] of piece) indices.set(k, m.label)
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

// --- the piece as a whole ---------------------------------------------------

/** A measure counts as known from this accuracy on (as "solid" above). */
export const GOOD_MEASURE = 0.85

export type PieceMeasures = Map<number, { label: string; notes: number }>

/**
 * The voice's measures: from the newest session that recorded them, else
 * (sessions saved before that) the measures sung so far. `complete` tells
 * whether the list is the whole piece.
 */
export function pieceMeasuresOf(sessions: SessionRecord[]): { measures: PieceMeasures; complete: boolean } {
  const known = [...sessions].reverse().find((s) => s.pieceMeasures && Object.keys(s.pieceMeasures).length)
  if (known?.pieceMeasures) {
    return {
      measures: new Map(Object.entries(known.pieceMeasures).map(([k, m]) => [Number(k), m])),
      complete: true,
    }
  }
  const measures: PieceMeasures = new Map()
  for (const s of sessions) {
    for (const [k, m] of Object.entries(s.measures)) {
      const prev = measures.get(Number(k))
      // Without the piece's note counts, the most notes sung there is the best guess.
      if (!prev || m.n > prev.notes) measures.set(Number(k), { label: m.label, notes: m.n })
    }
  }
  return { measures, complete: false }
}

const measureAccuracy = (s: SessionRecord, mi: number) => {
  const m = s.measures[mi]
  return m && m.n ? m.score / m.n : null
}

export interface RunScore {
  /** The run against the whole piece: unsung measures count as 0, so 100 % needs all of it. */
  score: number
  /** Share of the piece's notes that were sung in the run. */
  coverage: number
  /** How well the sung part went (the run's own hit rate). */
  accuracy: number
}

/** One run seen against the whole piece (its measures weighted by their notes). */
export function runScore(session: SessionRecord, piece: PieceMeasures): RunScore {
  let total = 0
  let sung = 0
  let points = 0
  for (const [mi, { notes }] of piece) {
    total += notes
    const acc = measureAccuracy(session, mi)
    if (acc === null) continue
    sung += notes
    points += acc * notes
  }
  if (total === 0) return { score: session.accuracy, coverage: 1, accuracy: session.accuracy }
  return { score: points / total, coverage: sung / total, accuracy: session.accuracy }
}

export interface Mastery {
  /** Share of the piece's measures known well (0..1). */
  share: number
  good: number
  total: number
  /** Measures never sung yet. */
  unsung: number
}

/**
 * How well the piece is known: a measure counts when its last `attempts`
 * tries (the runs that sang it) average GOOD_MEASURE or better; measures
 * not sung yet don't count. Practising section by section adds up.
 */
export function mastery(sessions: SessionRecord[], piece: PieceMeasures, attempts = 3): Mastery {
  let good = 0
  let unsung = 0
  for (const mi of piece.keys()) {
    const tries = sessions.map((s) => measureAccuracy(s, mi)).filter((v): v is number => v !== null).slice(-attempts)
    if (tries.length === 0) unsung++
    else if (mean(tries) >= GOOD_MEASURE) good++
  }
  const total = piece.size
  return { share: total ? good / total : 0, good, total, unsung }
}

export function formatMinutes(min: number) {
  if (min < 1) return min > 0 ? '< 1 Min.' : '0 Min.'
  if (min < 60) return `${Math.round(min)} Min.`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m ? `${h} Std. ${m} Min.` : `${h} Std.`
}
