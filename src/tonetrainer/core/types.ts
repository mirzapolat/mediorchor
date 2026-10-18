import type { Channel } from './audio/player'

export type { Channel }

/** Verdict for one sung note. good/ok count as hit; flat/sharp carry the direction of the miss. */
export type Grade = 'good' | 'ok' | 'flat' | 'sharp' | 'silent'

export interface MeasureStat {
  /** Printed measure number. */
  label: string
  n: number
  /** Sum of per-note scores (good = 1, ok = 0.6, otherwise 0). */
  score: number
  good: number
  ok: number
  flat: number
  sharp: number
  silent: number
  /** Sum of per-note average deviations in cents (negative = flat) and how many notes contributed. */
  biasSum: number
  biasN: number
}

/** One practice session of one voice. `songId` is the host app's ID of the score. */
export interface SessionRecord {
  id: string
  songId: string
  trackId: string
  trackName: string
  mode: 'play' | 'wait'
  startedAt: number
  endedAt: number
  practiceSec: number
  notes: number
  accuracy: number
  tempoFactor: number
  /** Keyed by 0-based source measure index. */
  measures: Record<number, MeasureStat>
}

/** Per-score view preferences remembered between visits. */
export interface ScorePrefs {
  trackId?: string
  mixer?: Record<string, Channel>
  zoom?: number
  zoomMobile?: number
  tempoFactor?: number
}
