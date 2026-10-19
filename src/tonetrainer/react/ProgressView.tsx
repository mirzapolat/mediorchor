import { ArrowDown, ArrowLeft, ArrowUp, Play, Repeat, TrendingDown, TrendingUp } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { formatMinutes, GOOD_MEASURE, mastery, measureTrends, pieceMeasuresOf, runScore, type MeasureTrend, type RunScore } from '../core/stats'
import type { PracticeStorage } from '../core/storage'
import type { SessionRecord } from '../core/types'
import { accuracyColor, DEFAULT_COLORS, useTrainerColors, type TrainerColors } from './theme'

const MAX_SESSIONS = 14

export interface ProgressViewProps {
  scoreId: string
  title: string
  storage: PracticeStorage
  onBack?: () => void
  /** Open the training view; with a measure index, that measure should be looped. */
  onPractice: (measureIndex?: number) => void
  /** Inside a host page that has its own title and start button: only the voice choice stays in the header. */
  embedded?: boolean
}

/** Date of a session, or its time when all shown sessions happened on the same day. */
function sessionLabel(s: SessionRecord, all: SessionRecord[]) {
  const day = (t: number) => new Date(t).toDateString()
  const sameDay = all.every((x) => day(x.startedAt) === day(all[0].startedAt))
  return sameDay
    ? new Date(s.startedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : new Date(s.startedAt).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' })
}

/** Progress of one score over many sessions: accuracy curve, recurring problems, measure heatmap. */
export default function ProgressView({ scoreId, title, storage, onBack, onPractice, embedded = false }: ProgressViewProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const colors = useTrainerColors(rootRef) ?? DEFAULT_COLORS
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null)
  const [trackId, setTrackId] = useState<string | null>(null)

  useEffect(() => {
    storage.sessions(scoreId).then((ss) => {
      setSessions(ss)
      setTrackId(ss.filter((x) => x.notes > 0).slice(-1)[0]?.trackId ?? null)
    })
  }, [scoreId, storage])

  const all = sessions ?? []
  // Every graded run of the voice (for how well the piece is known) and the
  // latest ones (charts and lists).
  const trackRuns = useMemo(() => all.filter((s) => s.trackId === trackId && s.notes > 0), [all, trackId])
  const graded = useMemo(() => trackRuns.slice(-MAX_SESSIONS), [trackRuns])
  // Runs are judged against the whole piece, not only the part sung.
  const piece = useMemo(() => pieceMeasuresOf(trackRuns), [trackRuns])
  const scores = useMemo(() => graded.map((s) => runScore(s, piece.measures)), [graded, piece])
  const known = useMemo(() => mastery(trackRuns, piece.measures), [trackRuns, piece])
  const trends = useMemo(() => measureTrends(graded, piece.measures), [graded, piece])
  const practicedTracks = useMemo(() => [...new Map(all.map((s) => [s.trackId, s.trackName])).entries()], [all])
  const totalMin = all.reduce((a, s) => a + s.practiceSec / 60, 0)
  const latest = scores[scores.length - 1]
  const best = scores.reduce((a, s) => Math.max(a, s.score), 0)
  const pct = (v: number) => `${Math.round(v * 100)} %`

  return (
    <div ref={rootRef} className={embedded ? 'tt-root tt-progress tt-progress--embedded' : 'tt-root tt-progress'}>
      <header className="tt-progress__header" hidden={embedded && practicedTracks.length < 2}>
        {!embedded && onBack && (
          <button className="tt-icon-btn" onClick={onBack} aria-label="Zurück">
            <ArrowLeft size={20} />
          </button>
        )}
        {!embedded && <h1 className="tt-progress__title">{title}</h1>}
        {practicedTracks.length > 1 && (
          <select className="tt-select" value={trackId ?? ''} onChange={(e) => setTrackId(e.target.value)} aria-label="Stimme">
            {practicedTracks.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}
        {!embedded && (
          <button className="tt-btn tt-btn--primary" onClick={() => onPractice()}>
            <Play size={16} fill="currentColor" /> Üben
          </button>
        )}
      </header>

      {/* The overall guide: how much of the piece is known well. */}
      {graded.length > 0 && (
        <section className="tt-mastery tt-surface" aria-label="So gut kannst du das Stück">
          <div className="tt-mastery__head">
            <div>
              <h2 className="tt-mastery__label">So gut kannst du das Stück</h2>
              <p className="tt-muted tt-mastery__sub">
                {known.good} von {known.total} Takten sicher
                {known.unsung > 0 && ` · ${known.unsung} noch nicht gesungen`}
              </p>
            </div>
            <p className="tt-mastery__value" style={{ color: accuracyColor(colors, known.share) }}>
              {pct(known.share)}
            </p>
          </div>
          <div className="tt-mastery__bar" aria-hidden>
            <span style={{ width: `${known.share * 100}%`, background: accuracyColor(colors, known.share) }} />
          </div>
          <p className="tt-muted tt-mastery__hint">
            Ein Takt zählt als sicher, wenn du ihn bei deinen letzten drei Versuchen im Schnitt zu mindestens {Math.round(GOOD_MEASURE * 100)} % triffst. Takte, die du noch nicht gesungen hast, zählen nicht.
            {!piece.complete && ' Gezählt werden vorerst die bisher gesungenen Takte – nach deinem nächsten Durchgang kennt der Trainer das ganze Stück.'}
          </p>
        </section>
      )}

      <dl className="tt-stats">
        {(
          [
            ['Geübt insgesamt', formatMinutes(totalMin), null],
            ['Durchgänge', String(graded.length), null],
            ['Zuletzt', latest ? pct(latest.score) : '–', latest ? `${pct(latest.coverage)} des Stücks gesungen` : null],
            ['Bestwert', graded.length ? pct(best) : '–', graded.length ? 'aufs ganze Stück' : null],
          ] as const
        ).map(([k, v, sub]) => (
          <div key={k} className="tt-stat tt-surface">
            <dt>{k}</dt>
            <dd>{v}</dd>
            {sub && <p className="tt-stat__sub tt-muted">{sub}</p>}
          </div>
        ))}
      </dl>

      {sessions && graded.length === 0 ? (
        <p className="tt-surface tt-pad tt-muted">Für diese Stimme gibt es noch keine bewerteten Durchgänge.</p>
      ) : graded.length > 0 ? (
        <>
          <section className="tt-surface tt-pad" aria-label="Genauigkeit pro Durchgang">
            <h2 className="tt-card-title">Ergebnis pro Durchgang</h2>
            <p className="tt-muted tt-card-hint">Aufs ganze Stück gerechnet: Was du nicht gesungen hast, zählt als nicht getroffen.</p>
            <AccuracyChart sessions={graded} scores={scores} colors={colors} />
          </section>

          <div className="tt-trends">
            <TrendList title="Hartnäckig" icon={<Repeat size={16} />} color={colors.sharp} items={trends.filter((t) => t.status === 'persistent')} colors={colors} onPractice={onPractice} empty="Keine Stelle, die immer wieder schiefgeht." />
            <TrendList
              title="Besser geworden"
              icon={<TrendingUp size={16} />}
              color={colors.tune}
              items={trends.filter((t) => t.status === 'improved')}
              colors={colors}
              onPractice={onPractice}
              empty={graded.length < 2 ? 'Nach dem zweiten Durchgang siehst du hier, welche Takte besser geworden sind.' : 'Noch keine deutliche Verbesserung messbar.'}
            />
            <TrendList title="Nachgelassen" icon={<TrendingDown size={16} />} color={colors.flat} items={trends.filter((t) => t.status === 'declined')} colors={colors} onPractice={onPractice} empty="Nichts ist schlechter geworden." />
          </div>

          <section className="tt-surface tt-pad" aria-label="Takte über die Durchgänge">
            <h2 className="tt-card-title">Takt für Takt über die Zeit</h2>
            <Heatmap sessions={graded} trends={trends} colors={colors} onPractice={onPractice} />
          </section>
        </>
      ) : null}
    </div>
  )
}

/** Width of an element, following resizes. */
function useWidth(ref: RefObject<Element | null>, fallback: number) {
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width) || fallback))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, fallback])
  return width
}

function AccuracyChart({ sessions, scores, colors }: { sessions: SessionRecord[]; scores: RunScore[]; colors: TrainerColors }) {
  // Drawn at its real width (not scaled down), so the labels stay readable on a phone.
  const ref = useRef<HTMLDivElement>(null)
  const W = useWidth(ref, 640)
  const H = W < 480 ? 140 : 160
  const pad = { l: 34, r: 12, t: 12, b: 24 }
  const xs = (i: number) => pad.l + (sessions.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (sessions.length - 1)) * (W - pad.l - pad.r))
  const ys = (v: number) => pad.t + (1 - v) * (H - pad.t - pad.b)
  const d = scores.map((s, i) => `${i ? 'L' : 'M'} ${xs(i)} ${ys(s.score)}`).join(' ')
  // Every n-th date where they would overlap, counted from the latest one.
  const step = Math.max(1, Math.ceil(44 / ((W - pad.l - pad.r) / Math.max(1, sessions.length - 1))))
  return (
    <div ref={ref}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="tt-chart" role="img" aria-label={`Ergebnis von ${Math.round(scores[0].score * 100)} % bis ${Math.round(scores[scores.length - 1].score * 100)} %`}>
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line className="tt-chart__grid" x1={pad.l} x2={W - pad.r} y1={ys(v)} y2={ys(v)} />
            <text className="tt-chart__label" x={pad.l - 6} y={ys(v) + 4} textAnchor="end">
              {v * 100}%
            </text>
          </g>
        ))}
        <path className="tt-chart__line" d={d} />
        {sessions.map((s, i) => (
          <g key={s.id}>
            <circle cx={xs(i)} cy={ys(scores[i].score)} r={4.5} fill={accuracyColor(colors, scores[i].score)}>
              <title>{`${new Date(s.startedAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}: ${Math.round(scores[i].score * 100)} % des Stücks (${Math.round(scores[i].coverage * 100)} % gesungen, davon ${Math.round(scores[i].accuracy * 100)} % getroffen; ${s.mode === 'wait' ? 'Warte-Modus' : `Mitsingen, ${Math.round(s.tempoFactor * 100)} % Tempo`})`}</title>
            </circle>
            {(sessions.length - 1 - i) % step === 0 && (
              <text className="tt-chart__label" x={xs(i)} y={H - 6} textAnchor="middle">
                {sessionLabel(s, sessions)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}

function TrendList({
  title,
  icon,
  color,
  items,
  colors,
  onPractice,
  empty,
}: {
  title: string
  icon: ReactNode
  color: string
  items: MeasureTrend[]
  colors: TrainerColors
  onPractice: (mi?: number) => void
  empty: string
}) {
  return (
    <section className="tt-surface tt-pad">
      <h2 className="tt-card-title tt-inline-icon" style={{ color }}>
        {icon} {title}
      </h2>
      {items.length === 0 ? (
        <p className="tt-muted">{empty}</p>
      ) : (
        <ul className="tt-list">
          {items.slice(0, 8).map((t) => (
            <li key={t.measureIndex}>
              <button className="tt-trend" onClick={() => onPractice(t.measureIndex)}>
                <span>
                  <strong>Takt {t.label}</strong>
                  {t.bias !== null && Math.abs(t.bias) > 12 && (
                    <span className="tt-trend__bias">
                      {t.bias < 0 ? <ArrowUp size={12} color={colors.flat} /> : <ArrowDown size={12} color={colors.sharp} />}
                      meist {t.bias < 0 ? 'zu tief' : 'zu hoch'}
                    </span>
                  )}
                </span>
                <span className="tt-muted">
                  {t.values
                    .filter((v): v is number => v !== null)
                    .slice(-3)
                    .map((v) => `${Math.round(v * 100)}`)
                    .join(' → ')}{' '}
                  %
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Heatmap({ sessions, trends, colors, onPractice }: { sessions: SessionRecord[]; trends: MeasureTrend[]; colors: TrainerColors; onPractice: (mi?: number) => void }) {
  return (
    <div className="tt-heatmap">
      <table>
        <thead>
          <tr>
            <th />
            {trends.map((t) => (
              <th key={t.measureIndex} scope="col">
                {t.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sessions.map((s, row) => (
            <tr key={s.id}>
              <th scope="row">{sessionLabel(s, sessions)}</th>
              {trends.map((t) => {
                const v = t.values[row]
                return (
                  <td key={t.measureIndex}>
                    <button
                      className="tt-heatmap__cell"
                      onClick={() => onPractice(t.measureIndex)}
                      style={v === null ? undefined : { background: accuracyColor(colors, v), opacity: 0.35 + v * 0.65 }}
                      title={v === null ? `Takt ${t.label}: nicht gesungen` : `Takt ${t.label}: ${Math.round(v * 100)} %`}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
