import type { ParsedNote, ParsedScore } from './musicxml/parse'

/** One pass through a source measure in playback order (repeats produce several visits per measure). */
export interface Visit {
  index: number
  measureIndex: number
  number: string
  startBeat: number
  lengthQ: number
}

export interface TNote {
  idx: number
  visit: number
  measureIndex: number
  offsetQ: number
  startBeat: number
  durBeats: number
  midi: number
  lyric?: string
  lyricJoin?: boolean
}

export interface TTrack {
  id: string
  name: string
  partIndex: number
  voice: string
  notes: TNote[]
  playNotes: TNote[]
  low: number
  high: number
}

interface TempoSeg {
  beat: number
  bpm: number
  sec: number
}

export class Timeline {
  readonly visits: Visit[] = []
  readonly tracks: TTrack[] = []
  readonly totalBeats: number
  private readonly tempo: TempoSeg[] = []

  constructor(score: ParsedScore, order?: number[]) {
    const measureOrder = order?.length ? order : score.measures.map((m) => m.index)
    let beat = 0
    for (const mi of measureOrder) {
      const m = score.measures[mi]
      if (!m) continue
      this.visits.push({ index: this.visits.length, measureIndex: mi, number: m.number, startBeat: beat, lengthQ: m.lengthQ })
      beat += m.lengthQ
    }
    this.totalBeats = beat

    const firstBpm = score.measures.find((m) => m.tempos.length)?.tempos[0].bpm ?? 96
    this.tempo.push({ beat: 0, bpm: firstBpm, sec: 0 })
    for (const v of this.visits) {
      for (const t of score.measures[v.measureIndex].tempos) {
        const b = v.startBeat + t.offsetQ
        const last = this.tempo[this.tempo.length - 1]
        if (t.bpm === last.bpm) continue
        if (b <= last.beat) last.bpm = t.bpm
        else this.tempo.push({ beat: b, bpm: t.bpm, sec: last.sec + ((b - last.beat) * 60) / last.bpm })
      }
    }

    for (const t of score.tracks) {
      const place = (src: ParsedNote[]) => {
        const byMeasure = groupBy(src, (n) => n.measureIndex)
        const out: TNote[] = []
        for (const v of this.visits) {
          const next = this.visits[v.index + 1]
          const contiguous = next?.measureIndex === v.measureIndex + 1
          for (const n of byMeasure.get(v.measureIndex) ?? []) {
            const dur = contiguous ? n.durQ : Math.min(n.durQ, v.lengthQ - n.offsetQ)
            out.push({
              idx: out.length,
              visit: v.index,
              measureIndex: v.measureIndex,
              offsetQ: n.offsetQ,
              startBeat: v.startBeat + n.offsetQ,
              durBeats: Math.max(dur, 0.05),
              midi: n.midi,
              lyric: n.lyric,
              lyricJoin: n.lyricJoin,
            })
          }
        }
        return out
      }
      const notes = place(t.notes)
      const pitches = notes.map((n) => n.midi)
      this.tracks.push({
        id: t.id,
        name: t.name,
        partIndex: t.partIndex,
        voice: t.voice,
        notes,
        playNotes: place(t.playNotes),
        low: Math.min(...pitches),
        high: Math.max(...pitches),
      })
    }
  }

  track(id: string) {
    return this.tracks.find((t) => t.id === id)
  }

  bpmAt(beat: number) {
    return this.segAtBeat(beat).bpm
  }

  /** Seconds at the score's own tempo. Negative beats (count-in) use the opening tempo. */
  beatToSec(beat: number) {
    const s = this.segAtBeat(beat)
    return s.sec + ((beat - s.beat) * 60) / s.bpm
  }

  secToBeat(sec: number) {
    let s = this.tempo[0]
    for (const seg of this.tempo) if (seg.sec <= sec) s = seg
    return s.beat + ((sec - s.sec) * s.bpm) / 60
  }

  visitAt(beat: number): Visit {
    const v = this.visits
    let lo = 0
    let hi = v.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (v[mid].startBeat <= beat) lo = mid
      else hi = mid - 1
    }
    return v[lo]
  }

  private segAtBeat(beat: number) {
    let s = this.tempo[0]
    for (const seg of this.tempo) if (seg.beat <= beat) s = seg
    return s
  }
}

/** Index of the note sounding at `beat` (or -1), searching from a hint for O(1) amortised lookups. */
export function noteAt(notes: TNote[], beat: number, hint = 0): number {
  let i = Math.min(Math.max(hint, 0), notes.length - 1)
  while (i > 0 && notes[i].startBeat > beat) i--
  while (i < notes.length - 1 && notes[i + 1].startBeat <= beat) i++
  const n = notes[i]
  return n && n.startBeat <= beat && beat < n.startBeat + n.durBeats ? i : -1
}

function groupBy<T, K>(items: T[], key: (t: T) => K) {
  const m = new Map<K, T[]>()
  for (const it of items) {
    const k = key(it)
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(it)
  }
  return m
}
