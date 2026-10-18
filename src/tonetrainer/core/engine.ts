import type { Mic } from './audio/mic'
import type { Player } from './audio/player'
import type { Grade, MeasureStat, SessionRecord } from './types'
import { centsOff } from './music'
import { noteAt, type Timeline, type TNote, type TTrack } from './timeline'

export type Mode = 'play' | 'wait'

export interface NoteResult {
  frames: number
  voiced: number
  hit: number
  near: number
  biasSum: number
  biasN: number
  waitMs: number
  grade: Grade | null
}

export interface PitchPoint {
  beat: number
  /** Audio clock time in seconds. */
  t: number
  midi: number | null
  cents: number | null
}

export interface Live {
  sung: number | null
  target: TNote | null
  /** Deviation from the target (or from the nearest semitone when there is no target). */
  cents: number | null
  inTune: boolean
  levelDb: number
  /** Last frame was ignored because it matched the accompaniment. */
  blocked: boolean
  beat: number
  /** Wait mode: progress of holding the current note, 0..1. */
  hold: number
}

export interface EngineConfig {
  tolerance: number
  ignoreOctave: boolean
  headphones: boolean
  refTone: boolean
  countIn: boolean
}

export type EngineEvent =
  | { type: 'state' }
  | { type: 'graded'; idx: number; grade: Grade | null }
  | { type: 'finished' }

export const GRADE_SCORE: Record<Grade, number> = { good: 1, ok: 0.6, flat: 0, sharp: 0, silent: 0 }

const HISTORY_SEC = 16
const fresh = (): NoteResult => ({ frames: 0, voiced: 0, hit: 0, near: 0, biasSum: 0, biasN: 0, waitMs: 0, grade: null })

export class PracticeEngine {
  readonly timeline: Timeline
  readonly player: Player
  track: TTrack
  mic: Mic | null = null
  config: EngineConfig
  mode: Mode = 'play'
  running = false
  results: NoteResult[] = []
  history: PitchPoint[] = []
  waitIdx = 0
  loop: { startVisit: number; endVisit: number } | null = null
  passes = 0
  practiceMs = 0
  startedAt = 0
  measureAgg = new Map<number, MeasureStat>()
  live: Live = { sung: null, target: null, cents: null, inTune: false, levelDb: -100, blocked: false, beat: 0, hold: 0 }

  private finalizeIdx = 0
  private staleResults = false
  private hint = 0
  private lastFrame = 0
  private holdMs = 0
  private listeners = new Set<(e: EngineEvent) => void>()

  constructor(timeline: Timeline, player: Player, trackId: string, config: EngineConfig) {
    this.timeline = timeline
    this.player = player
    this.track = timeline.track(trackId) ?? timeline.tracks[0]
    this.config = config
    this.results = this.track.notes.map(fresh)
    player.onLoop = () => this.handleLoop()
    player.onEnd = () => this.handleEnd()
  }

  on(fn: (e: EngineEvent) => void) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  private emit(e: EngineEvent) {
    for (const fn of this.listeners) fn(e)
  }

  get notes() {
    return this.track.notes
  }

  /** Beat and note-index range of the loop (or the whole piece). */
  range() {
    const v = this.timeline.visits
    const startBeat = this.loop ? v[this.loop.startVisit].startBeat : 0
    const endVisit = this.loop ? v[this.loop.endVisit] : v[v.length - 1]
    const endBeat = endVisit.startBeat + endVisit.lengthQ
    const first = this.notes.findIndex((n) => n.startBeat >= startBeat - 1e-6)
    let last = -1
    this.notes.forEach((n, i) => {
      if (n.startBeat < endBeat - 1e-6) last = i
    })
    return { startBeat, endBeat, first: first < 0 ? this.notes.length : first, last }
  }

  setConfig(c: Partial<EngineConfig>) {
    this.config = { ...this.config, ...c }
  }

  start() {
    if (this.running || !this.mic) return
    const r = this.range()
    if (this.staleResults) this.clearResults()
    this.startedAt ||= Date.now()
    if (this.mode === 'play') {
      let from = this.player.currentBeat()
      if (from < r.startBeat || from >= r.endBeat - 0.01) from = r.startBeat
      const visit = this.timeline.visitAt(from)
      const countIn = this.config.countIn ? (Math.abs(from - visit.startBeat) < 1e-6 ? visit.lengthQ : 4) : 0
      this.player.loop = this.loop ? { start: r.startBeat, end: r.endBeat } : null
      this.player.play(from, Math.min(countIn, 6))
      this.finalizeIdx = this.firstNoteFrom(from)
    } else {
      if (this.waitIdx < r.first || this.waitIdx > r.last) this.waitIdx = r.first
      this.arrive()
    }
    this.running = true
    this.emit({ type: 'state' })
  }

  pause() {
    if (!this.running) return
    this.player.pause()
    this.running = false
    this.holdMs = 0
    this.emit({ type: 'state' })
  }

  toggle() {
    if (this.running) this.pause()
    else this.start()
  }

  setMode(mode: Mode) {
    this.pause()
    if (mode === 'wait') this.waitIdx = Math.max(this.firstNoteFrom(this.player.currentBeat()), this.range().first)
    this.mode = mode
    this.emit({ type: 'state' })
  }

  seekToVisit(visitIndex: number) {
    const beat = this.timeline.visits[visitIndex]?.startBeat ?? 0
    if (this.mode === 'play') {
      this.player.seek(beat)
      this.finalizeIdx = this.firstNoteFrom(beat)
    } else {
      this.waitIdx = Math.min(this.firstNoteFrom(beat), this.notes.length - 1)
      this.holdMs = 0
      if (this.running) this.arrive()
    }
    this.hint = this.finalizeIdx
    this.emit({ type: 'state' })
  }

  setLoop(loop: { startVisit: number; endVisit: number } | null) {
    this.loop = loop ? { startVisit: Math.min(loop.startVisit, loop.endVisit), endVisit: Math.max(loop.startVisit, loop.endVisit) } : null
    const r = this.range()
    if (this.mode === 'play') {
      this.player.loop = this.loop && this.player.playing ? { start: r.startBeat, end: r.endBeat } : null
      const b = this.player.currentBeat()
      if (this.loop && (b < r.startBeat || b >= r.endBeat)) this.seekToVisit(this.loop.startVisit)
    } else if (this.loop && (this.waitIdx < r.first || this.waitIdx > r.last)) {
      this.seekToVisit(this.loop.startVisit)
    }
    this.emit({ type: 'state' })
  }

  /** Wait mode: give up on the current note and move on. */
  skip() {
    if (this.mode !== 'wait') return
    this.applyGrade(this.waitIdx, 'silent')
    this.advance()
  }

  playReference() {
    const n = this.live.target ?? this.notes[this.waitIdx]
    if (n) this.player.reference(n.midi)
  }

  /** Called once per animation frame. */
  frame(nowMs: number) {
    const dt = this.lastFrame ? Math.min(nowMs - this.lastFrame, 100) : 0
    this.lastFrame = nowMs
    if (!this.mic) return
    const f = this.mic.read()
    const ctxNow = this.player.ctx.currentTime
    const { tolerance, ignoreOctave } = this.config

    let target: TNote | null = null
    let beat: number
    let evalBeat: number
    if (this.mode === 'play') {
      const lag = this.mic.latency + (this.player.ctx.outputLatency || 0.02)
      evalBeat = this.player.playing ? this.player.beatAtTime(ctxNow - lag) : this.player.currentBeat()
      beat = this.player.currentBeat()
      const idx = noteAt(this.notes, evalBeat, this.hint)
      if (idx >= 0) this.hint = idx
      target = idx >= 0 ? this.notes[idx] : null
    } else {
      target = this.notes[this.waitIdx] ?? null
      evalBeat = beat = target?.startBeat ?? 0
    }

    let sung = f.midi
    let blocked = false
    if (sung !== null && !this.config.headphones) {
      // Without headphones the mic hears the playback too: drop frames that match a sounding note.
      for (const s of this.player.soundingAt(ctxNow - this.mic.latency)) {
        const isTarget = target && Math.abs(s - target.midi) < 0.3
        if (!isTarget && Math.abs(sung - s) < 0.3) {
          blocked = true
          sung = null
          break
        }
      }
    }

    const cents = sung === null ? null : target ? centsOff(sung, target.midi, ignoreOctave) : (sung - Math.round(sung)) * 100
    const inTune = cents !== null && Math.abs(cents) <= tolerance
    const need = target && target.durBeats < 0.75 ? 250 : 400

    if (this.running) {
      this.practiceMs += dt
      if (this.mode === 'play' && this.player.playing && evalBeat >= 0) {
        const notes = this.notes
        while (this.finalizeIdx < notes.length && notes[this.finalizeIdx].startBeat + notes[this.finalizeIdx].durBeats <= evalBeat) {
          this.gradePlay(this.finalizeIdx++)
        }
        if (target) {
          const beatsPerSec = (this.timeline.bpmAt(evalBeat) * this.player.factor) / 60
          const grace = Math.min(target.durBeats * 0.3, beatsPerSec * 0.12)
          if (evalBeat - target.startBeat >= grace) this.accumulate(this.results[target.idx], cents)
        }
      } else if (this.mode === 'wait' && target) {
        const r = this.results[target.idx]
        r.waitMs += dt
        this.accumulate(r, cents)
        this.holdMs = inTune ? this.holdMs + dt : Math.max(0, this.holdMs - dt * 2)
        if (this.holdMs >= need) {
          this.gradeWait(target.idx)
          this.advance()
        }
      }
    }

    this.history.push({ beat: evalBeat, t: ctxNow, midi: sung, cents })
    while (this.history.length && this.history[0].t < ctxNow - HISTORY_SEC) this.history.shift()

    this.live = { sung, target, cents, inTune, levelDb: f.rmsDb, blocked, beat, hold: this.mode === 'wait' ? Math.min(1, this.holdMs / need) : 0 }
  }

  /** Session record for the statistics, or null if too little was practised to be meaningful. */
  summary(songId: string): SessionRecord | null {
    if (this.practiceMs < 8000) return null
    let n = 0
    let score = 0
    for (const m of this.measureAgg.values()) {
      n += m.n
      score += m.score
    }
    return {
      id: crypto.randomUUID(),
      songId,
      trackId: this.track.id,
      trackName: this.track.name,
      mode: this.mode,
      startedAt: this.startedAt || Date.now() - this.practiceMs,
      endedAt: Date.now(),
      practiceSec: Math.round(this.practiceMs / 1000),
      notes: n,
      accuracy: n ? score / n : 0,
      tempoFactor: this.player.factor,
      measures: Object.fromEntries(this.measureAgg),
    }
  }

  /** Starts a new statistics session. Note colours stay visible until the next start. */
  resetSession() {
    this.measureAgg.clear()
    this.practiceMs = 0
    this.passes = 0
    this.startedAt = 0
    this.staleResults = true
  }

  private clearResults() {
    this.staleResults = false
    this.results = this.notes.map(fresh)
    for (let i = 0; i < this.notes.length; i++) this.emit({ type: 'graded', idx: i, grade: null })
  }

  dispose() {
    this.pause()
    this.player.onLoop = null
    this.player.onEnd = null
    this.listeners.clear()
  }

  private accumulate(r: NoteResult, cents: number | null) {
    r.frames++
    if (cents === null) return
    r.voiced++
    const a = Math.abs(cents)
    if (a <= this.config.tolerance) r.hit++
    else if (a <= this.config.tolerance * 2) r.near++
    if (a < 300) {
      r.biasSum += cents
      r.biasN++
    }
  }

  private firstNoteFrom(beat: number) {
    const i = this.notes.findIndex((n) => n.startBeat >= beat - 1e-6)
    return i < 0 ? this.notes.length : i
  }

  private gradePlay(i: number) {
    const r = this.results[i]
    if (r.frames < 3) return
    let grade: Grade
    if (r.voiced / r.frames < 0.3) grade = 'silent'
    else if (r.hit / r.frames >= 0.4 && r.hit / r.voiced >= 0.5) grade = 'good'
    else if ((r.hit + r.near) / r.frames >= 0.5) grade = 'ok'
    else grade = r.biasN && r.biasSum / r.biasN > 0 ? 'sharp' : 'flat'
    this.applyGrade(i, grade)
  }

  private gradeWait(i: number) {
    const r = this.results[i]
    let grade: Grade
    if (r.waitMs < 2000) grade = 'good'
    else if (r.waitMs < 5000) grade = 'ok'
    else grade = r.biasN && r.biasSum / r.biasN > 0 ? 'sharp' : 'flat'
    this.applyGrade(i, grade)
  }

  private applyGrade(i: number, grade: Grade) {
    const r = this.results[i]
    r.grade = grade
    const n = this.notes[i]
    let m = this.measureAgg.get(n.measureIndex)
    if (!m) {
      m = { label: this.timeline.visits[n.visit].number, n: 0, score: 0, good: 0, ok: 0, flat: 0, sharp: 0, silent: 0, biasSum: 0, biasN: 0 }
      this.measureAgg.set(n.measureIndex, m)
    }
    m.n++
    m.score += GRADE_SCORE[grade]
    m[grade]++
    if (r.biasN) {
      m.biasSum += r.biasSum / r.biasN
      m.biasN++
    }
    this.emit({ type: 'graded', idx: i, grade })
  }

  private arrive() {
    this.holdMs = 0
    const n = this.notes[this.waitIdx]
    if (!n) return
    this.results[this.waitIdx] = fresh()
    this.emit({ type: 'graded', idx: this.waitIdx, grade: null })
    if (this.config.refTone) this.player.reference(n.midi)
  }

  private advance() {
    const r = this.range()
    let next = this.waitIdx + 1
    if (this.loop && next > r.last) {
      this.passes++
      next = r.first
    }
    if (next >= this.notes.length) {
      this.running = false
      this.emit({ type: 'finished' })
      return
    }
    this.waitIdx = next
    this.arrive()
    this.emit({ type: 'state' })
  }

  private handleLoop() {
    const r = this.range()
    for (let i = this.finalizeIdx; i <= r.last; i++) this.gradePlay(i)
    this.passes++
    for (let i = r.first; i <= r.last; i++) {
      this.results[i] = fresh()
      this.emit({ type: 'graded', idx: i, grade: null })
    }
    this.finalizeIdx = r.first
    this.hint = r.first
    this.emit({ type: 'state' })
  }

  private handleEnd() {
    for (let i = this.finalizeIdx; i < this.notes.length; i++) this.gradePlay(i)
    this.finalizeIdx = this.notes.length
    this.running = false
    this.emit({ type: 'finished' })
  }
}
