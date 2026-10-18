import { Gauge, Pause, Play, Repeat, SkipBack, SkipForward, Timer, Volume2 } from 'lucide-react'
import { useId, useState } from 'react'
import type { Mode } from '../core/engine'
import type { Visit } from '../core/timeline'

interface Props {
  running: boolean
  mode: Mode
  visits: Visit[]
  currentVisit: number
  loop: { startVisit: number; endVisit: number } | null
  factor: number
  bpm: number
  metronome: boolean
  onToggle: () => void
  onRestart: () => void
  onFactor: (f: number) => void
  onLoop: (l: { startVisit: number; endVisit: number } | null) => void
  onMetronome: (v: boolean) => void
  onReference: () => void
  onSkip: () => void
}

/** Bottom bar: restart, play/pause, wait-mode helpers, position, tempo and loop (native popovers). */
export default function TransportBar(p: Props) {
  const uid = useId().replace(/:/g, '')
  const tempoId = `tt-tempo-${uid}`
  const loopId = `tt-loop-${uid}`
  const [from, setFrom] = useState(p.loop?.startVisit ?? p.currentVisit)
  const [to, setTo] = useState(p.loop?.endVisit ?? Math.min(p.currentVisit + 3, p.visits.length - 1))
  const visit = p.visits[p.currentVisit]
  const label = (v: Visit) => {
    const all = p.visits.filter((x) => x.measureIndex === v.measureIndex)
    return `Takt ${v.number}${all.length > 1 ? ` (${all.filter((x) => x.index <= v.index).length}. Mal)` : ''}`
  }
  const closeLoop = () => document.getElementById(loopId)?.hidePopover()

  return (
    <footer className="tt-transport">
      <button className="tt-icon-btn" onClick={p.onRestart} aria-label={p.loop ? 'Zum Anfang des Abschnitts' : 'Zum Anfang'}>
        <SkipBack size={20} />
      </button>
      <button onClick={p.onToggle} className="tt-play" aria-label={p.running ? 'Pause' : 'Start'} title="Leertaste">
        {p.running ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
      </button>

      {p.mode === 'wait' && (
        <>
          <button className="tt-btn" onClick={p.onReference} title="Taste R">
            <Volume2 size={18} />
            <span className="tt-hide-sm">Ton hören</span>
          </button>
          <button className="tt-icon-btn" onClick={p.onSkip} aria-label="Note überspringen" title="Pfeil rechts">
            <SkipForward size={20} />
          </button>
        </>
      )}

      <p className="tt-transport__pos tt-hide-sm">
        {visit ? label(visit) : ''} <span>von {p.visits[p.visits.length - 1]?.number}</span>
      </p>

      <div className="tt-transport__right">
        {p.mode === 'play' && (
          <>
            <button className="tt-btn" popovertarget={tempoId} aria-label="Tempo">
              <Gauge size={18} />
              <span>{Math.round(p.factor * 100)} %</span>
            </button>
            <div id={tempoId} popover="auto" className="tt-popover">
              <label className="tt-field">
                <span className="tt-field__top">
                  <span className="tt-field__label">Tempo</span>
                  <span className="tt-field__value">
                    {Math.round(p.factor * 100)} % ({Math.round(p.bpm * p.factor)} BPM)
                  </span>
                </span>
                <input type="range" className="tt-range" min={0.4} max={1.3} step={0.05} value={p.factor} onChange={(e) => p.onFactor(Number(e.target.value))} />
              </label>
              <div className="tt-chips">
                {[0.6, 0.75, 0.9, 1].map((f) => (
                  <button key={f} className="tt-btn tt-btn--small" aria-pressed={Math.abs(p.factor - f) < 0.01} onClick={() => p.onFactor(f)}>
                    {f * 100} %
                  </button>
                ))}
              </div>
              <label className="tt-field tt-field--row">
                <span className="tt-field__label tt-inline-icon">
                  <Timer size={16} /> Metronom
                </span>
                <input type="checkbox" role="switch" className="tt-switch" checked={p.metronome} onChange={(e) => p.onMetronome(e.target.checked)} />
              </label>
            </div>
          </>
        )}

        <button
          className="tt-btn"
          popovertarget={loopId}
          aria-pressed={!!p.loop}
          onClick={() => {
            setFrom(p.loop?.startVisit ?? p.currentVisit)
            setTo(p.loop?.endVisit ?? Math.min(p.currentVisit + 3, p.visits.length - 1))
          }}
        >
          <Repeat size={18} />
          <span className="tt-hide-sm">{p.loop ? `T. ${p.visits[p.loop.startVisit].number}–${p.visits[p.loop.endVisit].number}` : 'Abschnitt'}</span>
        </button>
        <div id={loopId} popover="auto" className="tt-popover tt-popover--wide">
          <p className="tt-field__label">Abschnitt in Schleife üben</p>
          <div className="tt-grid-2">
            <label className="tt-select-label">
              von
              <select className="tt-select" value={from} onChange={(e) => setFrom(Number(e.target.value))}>
                {p.visits.map((v) => (
                  <option key={v.index} value={v.index}>
                    {label(v)}
                  </option>
                ))}
              </select>
            </label>
            <label className="tt-select-label">
              bis
              <select className="tt-select" value={to} onChange={(e) => setTo(Number(e.target.value))}>
                {p.visits.map((v) => (
                  <option key={v.index} value={v.index} disabled={v.index < from}>
                    {label(v)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="tt-actions">
            {p.loop && (
              <button
                className="tt-btn"
                onClick={() => {
                  p.onLoop(null)
                  closeLoop()
                }}
              >
                Schleife beenden
              </button>
            )}
            <button
              className="tt-btn tt-btn--primary"
              onClick={() => {
                p.onLoop({ startVisit: from, endVisit: Math.max(from, to) })
                closeLoop()
              }}
            >
              Schleife starten
            </button>
          </div>
        </div>
      </div>
    </footer>
  )
}
