import { useEffect, useRef } from 'react'
import type { PitchPoint, PracticeEngine } from '../core/engine'
import { isBlackKey, noteName, type NoteNaming } from '../core/music'
import { gradeColor, type TrainerColors } from './theme'

const GUTTER = 44

/**
 * One Euro filter (Casiez et al. 2012) over the pitch history, in semitones. Holding a note it
 * smooths heavily (jitter vanishes, vibrato becomes a gentle wave); when the pitch moves fast,
 * as on a note change, the cutoff rises so the line follows without lag. Display only: grading
 * uses the unsmoothed values.
 */
function smoothTrail(history: PitchPoint[], minCutoff = 1, beta = 0.25, dCutoff = 1): (number | null)[] {
  const alpha = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt))
  const out: (number | null)[] = []
  let x = 0
  let dx = 0
  let lastT = -1
  for (const p of history) {
    if (p.midi === null) {
      lastT = -1
      out.push(null)
      continue
    }
    if (lastT < 0 || p.t - lastT > 0.15) {
      x = p.midi
      dx = 0
    } else {
      const dt = Math.max(1e-3, p.t - lastT)
      dx += alpha(dCutoff, dt) * ((p.midi - x) / dt - dx)
      x += alpha(minCutoff + beta * Math.abs(dx), dt) * (p.midi - x)
    }
    lastT = p.t
    out.push(x)
  }
  return out
}

/**
 * Scrolling note lane: target notes as bars (coloured once graded), the other voices faintly, and
 * the sung pitch as a smoothed line. Play mode scrolls by beat; wait mode keeps the current note at
 * the playhead and lets the sung line flow out to the left in real time.
 */
export default function PianoRoll({
  getEngine,
  tolerance,
  ignoreOctave,
  naming,
  colors,
  fontFamily = 'system-ui',
  onSeekVisit,
}: {
  getEngine: () => PracticeEngine | null
  tolerance: number
  ignoreOctave: boolean
  naming: NoteNaming
  colors: TrainerColors
  /** Font for labels and the count-in number, e.g. the host's UI font. */
  fontFamily?: string
  onSeekVisit: (visit: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const geom = useRef({ playheadX: 0, ppb: 80, beat: 0 })
  const opts = useRef({ tolerance, ignoreOctave, naming, colors, fontFamily })
  opts.current = { tolerance, ignoreOctave, naming, colors, fontFamily }

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let w = 0
    let h = 0
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    })
    ro.observe(canvas)

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const e = getEngine()
      ctx.clearRect(0, 0, w, h)
      if (!e || !w || !h) return
      const { tolerance: tol, ignoreOctave: fold, naming: nm, colors: C, fontFamily: font } = opts.current
      const track = e.track
      const tl = e.timeline
      const wait = e.mode === 'wait'
      const beat = wait ? (e.notes[e.waitIdx]?.startBeat ?? 0) : e.player.currentBeat()
      const ppb = Math.max(46, Math.min(120, (w - GUTTER) / 9))
      const playheadX = GUTTER + (w - GUTTER) * 0.28
      geom.current = { playheadX, ppb, beat }
      const xOf = (b: number) => playheadX + (b - beat) * ppb
      const lo = track.low - 3
      const hi = track.high + 3
      const padT = 22
      const padB = 8
      const rowH = (h - padT - padB) / (hi - lo + 1)
      const yOf = (m: number) => padT + (hi - m) * rowH
      const centre = (track.low + track.high) / 2
      const foldMidi = (m: number) => (fold ? m + 12 * Math.round((centre - m) / 12) : m)
      const beatMin = beat - (playheadX - GUTTER) / ppb - 1
      const beatMax = beat + (w - playheadX) / ppb + 1

      // Rows and pitch labels.
      ctx.font = `600 10px ${font}`
      ctx.textBaseline = 'middle'
      for (let m = lo; m <= hi; m++) {
        const y = yOf(m)
        if (isBlackKey(m)) {
          ctx.fillStyle = C.rollRowShade
          ctx.fillRect(GUTTER, y, w - GUTTER, rowH)
        }
        if (m % 12 === 0) {
          ctx.fillStyle = C.rollGrid
          ctx.fillRect(GUTTER, y + rowH - 1, w - GUTTER, 1)
        }
        if (rowH >= 10.5 || m % 12 === 0) {
          ctx.fillStyle = m % 12 === 0 ? C.rollLabelStrong : C.rollLabel
          ctx.fillText(noteName(m, nm), 8, y + rowH / 2)
        }
      }

      if (e.loop) {
        const r = e.range()
        const x0 = Math.max(GUTTER, xOf(r.startBeat))
        ctx.fillStyle = C.rollLoop
        ctx.fillRect(x0, 0, xOf(r.endBeat) - x0, h)
      }

      ctx.save()
      ctx.beginPath()
      ctx.rect(GUTTER, 0, w - GUTTER, h)
      ctx.clip()

      // Measures.
      ctx.textBaseline = 'top'
      for (const v of tl.visits) {
        if (v.startBeat > beatMax) break
        if (v.startBeat + v.lengthQ < beatMin) continue
        const x = xOf(v.startBeat)
        ctx.fillStyle = C.rollMeasure
        ctx.fillRect(x, padT - 4, 1, h)
        ctx.fillStyle = C.rollLabel
        ctx.fillText(v.number, x + 4, 5)
      }

      // Other voices, faint.
      ctx.fillStyle = C.rollOther
      for (const t of tl.tracks) {
        if (t.id === track.id) continue
        for (const n of t.notes) {
          if (n.startBeat > beatMax) break
          if (n.startBeat + n.durBeats < beatMin || n.midi < lo || n.midi > hi) continue
          ctx.fillRect(xOf(n.startBeat), yOf(n.midi) + rowH * 0.4, n.durBeats * ppb - 2, Math.max(2, rowH * 0.2))
        }
      }

      // Own notes.
      const target = e.live.target
      for (const n of track.notes) {
        if (n.startBeat > beatMax) break
        if (n.startBeat + n.durBeats < beatMin) continue
        const x = xOf(n.startBeat)
        const bw = Math.max(4, n.durBeats * ppb - 3)
        const y = yOf(n.midi) + rowH * 0.14
        const bh = Math.max(5, rowH * 0.72)
        const grade = e.results[n.idx]?.grade
        const isCurrent = target?.idx === n.idx
        ctx.fillStyle = grade ? gradeColor(C, grade) : isCurrent ? C.accent : n.startBeat + n.durBeats < beat ? C.rollPast : C.rollUpcoming
        if (isCurrent) {
          ctx.shadowColor = C.accentGlow
          ctx.shadowBlur = 16
        }
        ctx.beginPath()
        ctx.roundRect(x, y, bw, bh, Math.min(6, bh / 2))
        ctx.fill()
        ctx.shadowBlur = 0
        if (n.lyric && bw > 14) {
          ctx.fillStyle = isCurrent ? C.rollNoteTextCurrent : C.rollNoteText
          ctx.font = `600 ${Math.min(11, bh - 2)}px ${font}`
          ctx.textBaseline = 'middle'
          ctx.fillText(n.lyric, x + 4, y + bh / 2, bw - 6)
        }
      }

      // Pitch trail: smoothed for display only, drawn as one continuous curve per sung phrase.
      const now = e.player.ctx.currentTime
      const ppsec = ppb * 1.25
      const colorOf = (c: number | null) => (c === null ? C.free : Math.abs(c) <= tol ? C.tune : c < 0 ? C.flat : C.sharp)
      const smooth = smoothTrail(e.history)
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.shadowBlur = 8
      let run: { x: number; y: number; color: string }[] = []
      const flush = () => {
        for (let i = 1; i < run.length; i++) {
          const a = run[i - 1]
          const b = run[i]
          const prevMid = i > 1 ? { x: (run[i - 2].x + a.x) / 2, y: (run[i - 2].y + a.y) / 2 } : a
          const mid = i < run.length - 1 ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : b
          ctx.strokeStyle = a.color
          ctx.shadowColor = a.color
          ctx.beginPath()
          ctx.moveTo(prevMid.x, prevMid.y)
          ctx.quadraticCurveTo(a.x, a.y, mid.x, mid.y)
          ctx.stroke()
        }
        run = []
      }
      let lastT = -1
      e.history.forEach((p, i) => {
        const m = smooth[i]
        const x = wait ? playheadX - (now - p.t) * ppsec : xOf(p.beat)
        if (m === null || x < GUTTER - 4 || x > w || (lastT >= 0 && p.t - lastT > 0.15)) flush()
        lastT = p.t
        if (m === null || x < GUTTER - 4 || x > w) return
        // Shift the deviation by the amount the smoothing moved the pitch, so colour and line agree.
        const cents = p.cents === null || p.midi === null ? null : p.cents + (m - p.midi) * 100
        run.push({ x, y: yOf(foldMidi(m)) + rowH / 2, color: colorOf(cents) })
      })
      flush()
      ctx.shadowBlur = 0
      ctx.restore()

      // Playhead and live dot.
      const grad = ctx.createLinearGradient(0, 0, 0, h)
      grad.addColorStop(0, 'transparent')
      grad.addColorStop(0.5, C.accentGlow)
      grad.addColorStop(1, 'transparent')
      ctx.fillStyle = grad
      ctx.fillRect(playheadX - 1, 0, 2, h)
      const sung = e.live.sung
      const smoothed = smooth[smooth.length - 1]
      if (sung !== null && smoothed != null) {
        const y = Math.max(padT, Math.min(h - padB, yOf(foldMidi(smoothed)) + rowH / 2))
        const col = colorOf(e.live.cents === null ? null : e.live.cents + (smoothed - sung) * 100)
        ctx.fillStyle = col
        ctx.shadowColor = col
        ctx.shadowBlur = 18
        ctx.beginPath()
        ctx.arc(playheadX, y, 6.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
      }

      // Count-in.
      if (!wait && e.player.playing && beat < 0) {
        ctx.fillStyle = C.accent
        ctx.font = `600 64px ${font}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(Math.ceil(-beat)), (w + GUTTER) / 2, h / 2)
        ctx.textAlign = 'start'
      }
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [getEngine])

  const onClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const e = getEngine()
    if (!e) return
    const r = ev.currentTarget.getBoundingClientRect()
    const { playheadX, ppb, beat } = geom.current
    const b = beat + (ev.clientX - r.left - playheadX) / ppb
    if (b < 0 || b > e.timeline.totalBeats) return
    onSeekVisit(e.timeline.visitAt(b).index)
  }

  return <canvas ref={canvasRef} onClick={onClick} className="tt-roll__canvas" aria-label="Notenrolle mit deinem Tonhöhenverlauf. Klicke, um zu einem Takt zu springen." />
}
