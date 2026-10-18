import type { Timeline } from '../timeline'
import { playClick, playTone, type Voice } from './synth'

export interface Channel {
  volume: number
  muted: boolean
  solo: boolean
}

interface Scheduled {
  voice: Voice
  midi: number
  trackId: string
  start: number
  end: number
}

const LOOKAHEAD = 0.15
const TICK_MS = 25

/**
 * Plays the timeline with a look-ahead scheduler (Web Audio clock, not setTimeout, decides timing).
 * Position is kept as an anchor (audio time ↔ beat), so tempo changes and seeks stay sample-accurate.
 */
export class Player {
  readonly ctx: AudioContext
  private readonly master: GainNode
  private readonly gains = new Map<string, GainNode>()
  private readonly refGain: GainNode
  private readonly clickGain: GainNode
  private channels = new Map<string, Channel>()
  private timeline: Timeline
  private timer: number | null = null
  private ptr = new Map<string, number>()
  private nextClick = 0
  private scheduled: Scheduled[] = []
  private anchorTime = 0
  private anchorBeat = 0
  private startBeat = 0
  playing = false
  factor = 1
  a4 = 440
  metronome = false
  loop: { start: number; end: number } | null = null
  onEnd: (() => void) | null = null
  onLoop: (() => void) | null = null

  constructor(ctx: AudioContext, timeline: Timeline) {
    this.ctx = ctx
    this.timeline = timeline
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -12
    comp.connect(ctx.destination)
    this.master = ctx.createGain()
    this.master.gain.value = 0.9
    this.master.connect(comp)
    this.refGain = ctx.createGain()
    this.refGain.connect(this.master)
    this.clickGain = ctx.createGain()
    this.clickGain.gain.value = 0.6
    this.clickGain.connect(this.master)
    for (const t of timeline.tracks) {
      const g = ctx.createGain()
      g.connect(this.master)
      this.gains.set(t.id, g)
      this.channels.set(t.id, { volume: 0.8, muted: false, solo: false })
    }
    this.applyMix()
  }

  setMix(channels: Record<string, Channel>) {
    for (const [id, ch] of Object.entries(channels)) if (this.channels.has(id)) this.channels.set(id, ch)
    this.applyMix()
  }

  /** Effective linear gain of a track after mute/solo. */
  gainOf(trackId: string) {
    const ch = this.channels.get(trackId)
    if (!ch) return 0
    const anySolo = [...this.channels.values()].some((c) => c.solo)
    if (ch.muted || (anySolo && !ch.solo)) return 0
    return ch.volume * ch.volume
  }

  private applyMix() {
    for (const [id, g] of this.gains) g.gain.setTargetAtTime(this.gainOf(id), this.ctx.currentTime, 0.02)
  }

  beatAtTime(t: number) {
    const tl = this.timeline
    return tl.secToBeat(tl.beatToSec(this.anchorBeat) + (t - this.anchorTime) * this.factor)
  }

  timeOfBeat(beat: number) {
    const tl = this.timeline
    return this.anchorTime + (tl.beatToSec(beat) - tl.beatToSec(this.anchorBeat)) / this.factor
  }

  currentBeat() {
    return this.playing ? this.beatAtTime(this.ctx.currentTime) : this.anchorBeat
  }

  play(fromBeat: number, countInBeats = 0) {
    this.stopVoices()
    this.startBeat = fromBeat
    this.anchorBeat = fromBeat - countInBeats
    this.anchorTime = this.ctx.currentTime + 0.08
    this.nextClick = Math.ceil(this.anchorBeat - 1e-6)
    this.resetPointers(fromBeat)
    this.playing = true
    this.timer ??= window.setInterval(() => this.tick(), TICK_MS)
    this.tick()
  }

  pause() {
    if (!this.playing) return
    this.anchorBeat = Math.max(this.currentBeat(), this.startBeat)
    this.playing = false
    this.stopVoices()
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
  }

  seek(beat: number) {
    if (this.playing) this.play(beat)
    else this.anchorBeat = beat
  }

  setFactor(f: number) {
    const b = this.currentBeat()
    this.factor = f
    if (this.playing) {
      // Already-scheduled notes were timed for the old tempo; reschedule from the current position.
      this.stopVoices()
      this.anchorTime = this.ctx.currentTime
      this.anchorBeat = b
      this.startBeat = Math.min(this.startBeat, b)
      this.resetPointers(b)
      this.nextClick = Math.ceil(b)
    }
  }

  /** Short tone of the given pitch on the reference bus (wait mode prompt). */
  reference(midi: number, dur = 0.9) {
    const t = this.ctx.currentTime + 0.02
    const voice = playTone(this.ctx, this.refGain, midi, t, dur, this.a4, 0.26)
    this.scheduled.push({ voice, midi, trackId: '__ref', start: t, end: t + dur })
  }

  /** Pitches audible from the speakers at time `t` (used to ignore playback picked up by the mic). */
  soundingAt(t: number) {
    const out: number[] = []
    for (const s of this.scheduled) {
      if (s.start <= t && t <= s.end + 0.2 && (s.trackId === '__ref' || this.gainOf(s.trackId) > 0.02)) out.push(s.midi)
    }
    return out
  }

  dispose() {
    this.pause()
    this.master.disconnect()
  }

  private resetPointers(beat: number) {
    for (const t of this.timeline.tracks) {
      const i = t.playNotes.findIndex((n) => n.startBeat >= beat - 1e-6)
      this.ptr.set(t.id, i < 0 ? t.playNotes.length : i)
    }
  }

  private stopVoices() {
    const now = this.ctx.currentTime
    for (const s of this.scheduled) if (s.end > now) s.voice.stop(now)
    this.scheduled = []
  }

  private tick() {
    if (!this.playing) return
    const now = this.ctx.currentTime
    const beatNow = this.beatAtTime(now)

    if (this.loop && beatNow >= this.loop.end) {
      this.onLoop?.()
      this.play(this.loop.start)
      return
    }
    if (!this.loop && beatNow >= this.timeline.totalBeats) {
      this.pause()
      this.anchorBeat = this.timeline.totalBeats
      this.onEnd?.()
      return
    }

    const horizon = now + LOOKAHEAD
    const limit = this.loop?.end ?? Infinity
    for (const t of this.timeline.tracks) {
      const notes = t.playNotes
      let i = this.ptr.get(t.id) ?? 0
      const dest = this.gains.get(t.id)!
      while (i < notes.length && this.timeOfBeat(notes[i].startBeat) < horizon && notes[i].startBeat < limit) {
        const n = notes[i]
        const start = Math.max(this.timeOfBeat(n.startBeat), now)
        const endBeat = Math.min(n.startBeat + n.durBeats, limit)
        const end = this.timeOfBeat(endBeat) - 0.015
        const voice = playTone(this.ctx, dest, n.midi, start, end - start, this.a4)
        this.scheduled.push({ voice, midi: n.midi, trackId: t.id, start, end })
        i++
      }
      this.ptr.set(t.id, i)
    }

    while (this.timeOfBeat(this.nextClick) < horizon && (this.nextClick < this.startBeat || this.metronome)) {
      const b = this.nextClick
      const accent = b < this.startBeat ? b === Math.ceil(this.anchorBeat - 1e-6) : Math.abs(b - this.timeline.visitAt(b).startBeat) < 1e-6
      playClick(this.ctx, this.clickGain, Math.max(this.timeOfBeat(b), now), accent)
      this.nextClick++
    }

    this.scheduled = this.scheduled.filter((s) => s.end > now - 0.5)
  }
}
