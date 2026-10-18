import { ArrowDown, ArrowUp, Check, MicOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Live } from '../core/engine'
import { noteParts, type NoteNaming } from '../core/music'
import type { TrainerColors } from './theme'

type Tone = 'idle' | 'tune' | 'flat' | 'sharp'

/** Gauge range in cents to each side. */
const RANGE = 100
const W = 320
const H = 96
const MID = H / 2 + 6

interface Display {
  name: string
  octave: number | null
  tone: Tone
  message: string
  target: string | null
  far: 'up' | 'down' | null
}

function describe(live: Live, tol: number, naming: NoteNaming): Display {
  const target = live.target ? noteParts(live.target.midi, naming) : null
  const targetLabel = target ? `${target.name}${target.octave}` : null
  if (live.sung === null || live.cents === null) {
    return {
      name: '–',
      octave: null,
      tone: 'idle',
      message: live.blocked ? 'Begleitung erkannt, sing lauter oder nutze Kopfhörer' : target ? `Sing ${targetLabel}` : 'Sing einen Ton',
      target: targetLabel,
      far: null,
    }
  }
  const sung = noteParts(live.sung, naming)
  const c = Math.round(live.cents)
  const tone: Tone = Math.abs(c) <= tol ? 'tune' : c < 0 ? 'flat' : 'sharp'
  const semis = Math.round(Math.abs(c) / 100)
  let message: string
  if (!live.target) message = tone === 'tune' ? 'Sauber' : `${Math.abs(c)} Cent ${c < 0 ? 'zu tief' : 'zu hoch'}`
  else if (tone === 'tune') message = 'Sauber getroffen'
  else if (Math.abs(c) >= 90) message = `${semis} ${semis === 1 ? 'Halbton' : 'Halbtöne'} ${c < 0 ? 'zu tief' : 'zu hoch'}`
  else message = `${Math.abs(c)} Cent ${c < 0 ? 'zu tief' : 'zu hoch'}`
  return { name: sung.name, octave: sung.octave, tone, message, target: targetLabel, far: Math.abs(c) > RANGE ? (c < 0 ? 'up' : 'down') : null }
}

/** Critically-damped-ish spring, advanced per animation frame. */
function spring(state: { x: number; v: number }, target: number, dt: number, k = 430, c = 43) {
  const steps = Math.max(1, Math.ceil(dt / 0.008))
  const h = dt / steps
  for (let i = 0; i < steps; i++) {
    state.v += (k * (target - state.x) - c * state.v) * h
    state.x += state.v * h
  }
  return state.x
}

/**
 * Sung note name plus a horizontal "string": the dot sits at the deviation from the target and the
 * string bends towards it. Colour encodes direction (flat / in tune / sharp). Values are animated
 * in a requestAnimationFrame loop that writes SVG attributes directly, so React only re-renders
 * when the displayed text changes.
 */
export default function Tuner({
  getLive,
  tolerance,
  naming,
  micOn,
  waitMode,
  colors,
  compact = false,
}: {
  getLive: () => Live
  tolerance: number
  naming: NoteNaming
  micOn: boolean
  waitMode: boolean
  colors: TrainerColors
  /** Phone layout: note and gauge side by side in a short strip. */
  compact?: boolean
}) {
  const [d, setD] = useState<Display>({ name: '–', octave: null, tone: 'idle', message: 'Sing einen Ton', target: null, far: null })
  const pathRef = useRef<SVGPathElement>(null)
  const dotRef = useRef<SVGCircleElement>(null)
  const holdRef = useRef<HTMLDivElement>(null)
  const levelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    let last = ''
    let prevT = performance.now()
    const cents = { x: 0, v: 0 }
    const voiced = { x: 0, v: 0 }
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - prevT) / 1000)
      prevT = t
      const live = getLive()
      const c = live.cents === null ? cents.x : Math.max(-RANGE * 1.15, Math.min(RANGE * 1.15, live.cents))
      spring(cents, c, dt)
      spring(voiced, live.cents === null ? 0 : 1, dt, 200, 30)
      const x = W / 2 + (cents.x / RANGE) * (W / 2 - 14)
      const bend = Math.min(Math.abs(cents.x) / RANGE, 1) * 26 * Math.max(0, voiced.x)
      pathRef.current?.setAttribute('d', `M 8 ${MID} Q ${x} ${MID + bend * 2} ${W - 8} ${MID}`)
      dotRef.current?.setAttribute('cx', String(x))
      dotRef.current?.setAttribute('cy', String(MID + bend))
      if (holdRef.current) holdRef.current.style.width = `${live.hold * 100}%`
      if (levelRef.current) levelRef.current.style.width = `${Math.max(0, Math.min(1, (live.levelDb + 70) / 55)) * 100}%`
      const next = describe(live, tolerance, naming)
      const sig = JSON.stringify(next)
      if (sig !== last) {
        last = sig
        setD(next)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [getLive, tolerance, naming])

  const color = { idle: colors.silent, tune: colors.tune, flat: colors.flat, sharp: colors.sharp }[d.tone]
  const tolW = (tolerance / RANGE) * (W / 2 - 14)
  const iconSize = compact ? 15 : 18

  const gauge = (
    <svg viewBox={`0 0 ${W} ${H}`} className="tt-tuner__gauge" role="img" aria-label="Abweichung in Cent">
      <rect className="tt-tuner__zone" x={W / 2 - tolW} y={MID - 30} width={tolW * 2} height={60} rx={8} />
      {[-100, -50, 0, 50, 100].map((c) => {
        const tx = W / 2 + (c / RANGE) * (W / 2 - 14)
        return (
          <g key={c}>
            <line className={c === 0 ? 'tt-tuner__tick tt-tuner__tick--center' : 'tt-tuner__tick'} x1={tx} x2={tx} y1={MID - (c === 0 ? 34 : 10)} y2={MID + (c === 0 ? 34 : 10)} />
            {c !== 0 && (
              <text className="tt-tuner__scale" x={tx} y={H - 2} textAnchor="middle">
                {c > 0 ? `+${c}` : `−${-c}`}
              </text>
            )}
          </g>
        )
      })}
      <path ref={pathRef} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" opacity={d.tone === 'idle' ? 0.35 : 1} />
      <circle ref={dotRef} r={9} fill={color} opacity={d.tone === 'idle' ? 0 : 1} style={{ filter: `drop-shadow(0 0 10px ${color})` }} />
      {d.far && (
        <text className="tt-tuner__far" x={d.far === 'up' ? 4 : W - 4} y={MID - 16} textAnchor={d.far === 'up' ? 'start' : 'end'} fill={color}>
          {d.far === 'up' ? '◀ höher singen' : 'tiefer singen ▶'}
        </text>
      )}
    </svg>
  )

  const noteBlock = (
    <div className="tt-tuner__note" aria-live="polite" aria-atomic style={{ color: d.tone === 'idle' ? undefined : color }} data-tone={d.tone}>
      <span key={d.name} className="tt-tuner__name">
        {d.name}
      </span>
      {d.octave !== null && <span className="tt-tuner__octave">{d.octave}</span>}
    </div>
  )

  const message = (
    <p className="tt-tuner__message" style={{ color: d.tone === 'idle' ? undefined : color }}>
      {!micOn ? (
        <>
          <MicOff size={iconSize} /> Mikrofon ist aus
        </>
      ) : (
        <>
          {d.tone === 'tune' && <Check size={iconSize} />}
          {d.tone === 'flat' && <ArrowUp size={iconSize} />}
          {d.tone === 'sharp' && <ArrowDown size={iconSize} />}
          {d.message}
        </>
      )}
    </p>
  )

  const target = (
    <span className="tt-tuner__target">
      Ziel <strong>{d.target ?? '–'}</strong>
    </span>
  )

  return (
    <section aria-label="Stimmgerät" className={`tt-tuner ${compact ? 'tt-tuner--compact' : ''}`} data-tone={d.tone}>
      <div className="tt-tuner__glow" aria-hidden />
      {compact ? (
        <>
          <div className="tt-tuner__left">
            {target}
            {noteBlock}
            {message}
          </div>
          <div className="tt-tuner__right">
            {gauge}
            {waitMode && (
              <div className="tt-tuner__bar">
                <div ref={holdRef} className="tt-tuner__bar-fill tt-tuner__bar-fill--hold" />
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="tt-tuner__head">
            {target}
            <span>Gesungen</span>
          </div>
          <div className="tt-tuner__main">
            {noteBlock}
            {message}
          </div>
          {gauge}
          {waitMode && (
            <div className="tt-tuner__hold">
              <div className="tt-tuner__bar">
                <div ref={holdRef} className="tt-tuner__bar-fill tt-tuner__bar-fill--hold" />
              </div>
              <p className="tt-tuner__hint">Halte den Ton, bis der Balken voll ist.</p>
            </div>
          )}
          <div className="tt-tuner__level">
            <span>Eingang</span>
            <div className="tt-tuner__bar tt-tuner__bar--thin">
              <div ref={levelRef} className="tt-tuner__bar-fill tt-tuner__bar-fill--level" />
            </div>
          </div>
        </>
      )}
    </section>
  )
}
