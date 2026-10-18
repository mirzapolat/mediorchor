import { McLeodDetector } from './mpm'

export interface TrackerOptions {
  sampleRate: number
  bufferSize: number
  a4?: number
  /** Minimum MPM clarity for a frame to count as sung (0..1). */
  minClarity?: number
  /** Absolute input level below which nothing is analysed, in dBFS. */
  gateDb?: number
  minFreq?: number
  maxFreq?: number
}

export interface TrackerFrame {
  /** Smoothed pitch as fractional MIDI number, or null when nothing is being sung. */
  midi: number | null
  /** Unsmoothed detector output (fractional MIDI) – useful for debugging. */
  raw: number | null
  clarity: number
  rmsDb: number
  noiseFloorDb: number
}

const HISTORY = 5
const HANGOVER_FRAMES = 2
const OCTAVE_CONFIRM_FRAMES = 4

/**
 * Turns raw MPM estimates into a stable pitch track:
 *  - adaptive noise gate (so breathing / room noise doesn't produce notes)
 *  - clarity threshold (rejects consonants, noise, chords)
 *  - octave-jump hysteresis (a sudden ±12 semitone jump must persist before it is believed)
 *  - 5-frame median filter (kills single-frame glitches without lagging behind real note changes)
 *  - short hangover so a 1–2 frame dropout doesn't break a held note
 */
export class PitchTracker {
  private readonly detector: McLeodDetector
  private readonly opts: Required<Omit<TrackerOptions, 'sampleRate' | 'bufferSize'>>
  private history: (number | null)[] = []
  private last: number | null = null
  private dropout = 0
  private octavePending = 0
  private noiseFloor = -70

  constructor(opts: TrackerOptions) {
    this.opts = {
      a4: opts.a4 ?? 440,
      minClarity: opts.minClarity ?? 0.86,
      gateDb: opts.gateDb ?? -62,
      minFreq: opts.minFreq ?? 60,
      maxFreq: opts.maxFreq ?? 1500,
    }
    this.detector = new McLeodDetector({
      sampleRate: opts.sampleRate,
      bufferSize: opts.bufferSize,
      minFreq: this.opts.minFreq,
      maxFreq: this.opts.maxFreq,
    })
  }

  configure(patch: Partial<Pick<TrackerOptions, 'a4' | 'minClarity' | 'gateDb'>>) {
    Object.assign(this.opts, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)))
  }

  reset() {
    this.history = []
    this.last = null
    this.dropout = 0
    this.octavePending = 0
  }

  process(buf: ArrayLike<number>): TrackerFrame {
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    const rmsDb = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-12)

    // Floor follows quiet passages quickly and rises slowly (≈1 dB/s at 60 fps) while singing.
    if (rmsDb < this.noiseFloor) this.noiseFloor = this.noiseFloor * 0.6 + rmsDb * 0.4
    else this.noiseFloor = Math.min(this.noiseFloor + 0.015, -35)

    let raw: number | null = null
    let clarity = 0
    if (rmsDb > Math.max(this.opts.gateDb, this.noiseFloor + 9)) {
      const est = this.detector.detect(buf)
      if (est) {
        clarity = est.clarity
        if (est.clarity >= this.opts.minClarity && est.freq >= this.opts.minFreq && est.freq <= this.opts.maxFreq) {
          raw = freqToMidi(est.freq, this.opts.a4)
        }
      }
    }

    let value = raw
    if (value !== null && this.last !== null) {
      const jump = value - this.last
      if (Math.abs(Math.abs(jump) - 12) < 0.8) {
        this.octavePending++
        if (this.octavePending < OCTAVE_CONFIRM_FRAMES) value -= Math.sign(jump) * 12
        else this.history = []
      } else this.octavePending = 0
    }

    this.history.push(value)
    if (this.history.length > HISTORY) this.history.shift()

    let midi: number | null = null
    if (value !== null) {
      this.dropout = 0
      const v = value
      const near = this.history.filter((h): h is number => h !== null && Math.abs(h - v) < 1.5)
      midi = near.length >= 3 ? median(near) : v
    } else if (this.last !== null && ++this.dropout <= HANGOVER_FRAMES) {
      midi = this.last
    }
    this.last = midi
    return { midi, raw, clarity, rmsDb, noiseFloorDb: this.noiseFloor }
  }
}

export function freqToMidi(freq: number, a4 = 440) {
  return 69 + 12 * Math.log2(freq / a4)
}

function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
