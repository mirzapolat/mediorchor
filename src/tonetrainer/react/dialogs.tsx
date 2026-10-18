import { ArrowDown, ArrowUp, Mic, Repeat, Target, TrendingDown, TrendingUp, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { listMics } from '../core/audio/mic'
import type { Channel } from '../core/audio/player'
import { noteName } from '../core/music'
import type { PracticeSettings, Sensitivity } from '../core/settings'
import type { TTrack } from '../core/timeline'
import type { SessionRecord } from '../core/types'
import { accuracyColor, type TrainerColors } from './theme'
import { Dialog, Segmented, Slider, Switch } from './ui'
import { activePreset, MIX_PRESETS, presetMix } from './usePracticeSession'

export function TrackPicker({
  open,
  tracks,
  current,
  naming,
  onPick,
  onClose,
}: {
  open: boolean
  tracks: TTrack[]
  current?: string | null
  naming: PracticeSettings['naming']
  onPick: (id: string) => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Welche Stimme singst du?">
      <ul className="tt-list">
        {tracks.map((t) => (
          <li key={t.id}>
            <button onClick={() => onPick(t.id)} className="tt-track-option" aria-pressed={t.id === current}>
              <span className="tt-track-option__name">{t.name}</span>
              <span className="tt-track-option__range">
                {noteName(t.low, naming)} bis {noteName(t.high, naming)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}

export function MixerDialog({
  open,
  onClose,
  tracks,
  ownId,
  mixer,
  onChange,
}: {
  open: boolean
  onClose: () => void
  tracks: TTrack[]
  ownId: string
  mixer: Record<string, Channel>
  onChange: (m: Record<string, Channel>) => void
}) {
  const ids = tracks.map((t) => t.id)
  const set = (id: string, patch: Partial<Channel>) => onChange({ ...mixer, [id]: { ...mixer[id], ...patch } })
  const ordered = [...tracks].sort((a, b) => Number(b.id === ownId) - Number(a.id === ownId))
  const active = activePreset(ids, ownId, mixer)
  return (
    <Dialog open={open} onClose={onClose} title="Mixer">
      <Segmented stretch label="Voreinstellung" value={active?.id ?? null} onChange={(id) => onChange(presetMix(ids, ownId, id))} options={MIX_PRESETS.map((p) => ({ value: p.id, label: p.label }))} />
      <p className="tt-muted tt-mt-2">{active ? active.hint : 'Eigene Mischung'}</p>
      <ul className="tt-mixer">
        {ordered.map((t) => {
          const ch = mixer[t.id] ?? { volume: 0.8, muted: false, solo: false }
          const own = t.id === ownId
          return (
            <li key={t.id} className={`tt-mixer__row ${own ? 'tt-mixer__row--own' : ''}`}>
              <div className="tt-mixer__head">
                <span className="tt-mixer__name">
                  {t.name}
                  {own && <span className="tt-mixer__own">deine Stimme</span>}
                </span>
                <button className="tt-icon-btn" aria-pressed={ch.muted} aria-label={`${t.name} stummschalten`} onClick={() => set(t.id, { muted: !ch.muted })}>
                  {ch.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
                <button className="tt-icon-btn tt-icon-btn--text" aria-pressed={ch.solo} aria-label={`${t.name} solo`} onClick={() => set(t.id, { solo: !ch.solo })}>
                  S
                </button>
              </div>
              <input
                type="range"
                className="tt-range"
                min={0}
                max={1}
                step={0.01}
                value={ch.volume}
                aria-label={`Lautstärke ${t.name}`}
                onChange={(e) => set(t.id, { volume: Number(e.target.value), muted: false })}
                style={{ opacity: ch.muted ? 0.4 : 1 }}
              />
            </li>
          )
        })}
      </ul>
    </Dialog>
  )
}

export function SettingsDialog({
  open,
  onClose,
  settings: s,
  onChange,
  micLabel,
}: {
  open: boolean
  onClose: () => void
  settings: PracticeSettings
  onChange: (patch: Partial<PracticeSettings>) => void
  /** Changes when the mic opens, so device labels get re-read after permission. */
  micLabel: string
}) {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    if (open) listMics().then(setMics, () => setMics([]))
  }, [open, micLabel])

  return (
    <Dialog open={open} onClose={onClose} title="Einstellungen">
      <h3 className="tt-section-title">
        <Mic size={15} /> Mikrofon
      </h3>
      {mics.some((m) => m.label) ? (
        <select className="tt-select tt-select--full" value={s.micDeviceId ?? ''} onChange={(e) => onChange({ micDeviceId: e.target.value || null })} aria-label="Mikrofon">
          <option value="">Standard-Mikrofon</option>
          {mics.map((m) => (
            <option key={m.deviceId} value={m.deviceId}>
              {m.label || 'Mikrofon'}
            </option>
          ))}
        </select>
      ) : (
        <p className="tt-muted">Aktiviere das Mikrofon, um eines auszuwählen.</p>
      )}
      <Switch
        checked={s.headphones}
        onChange={(v) => onChange({ headphones: v })}
        label="Ich nutze Kopfhörer"
        hint={s.headphones ? undefined : 'Töne der Begleitung werden herausgefiltert und die Echo-Unterdrückung ist an.'}
      />
      <div className="tt-field">
        <span className="tt-field__label">Erkennung</span>
        <Segmented<Sensitivity>
          label="Erkennung"
          value={s.sensitivity}
          onChange={(v) => onChange({ sensitivity: v })}
          options={[
            { value: 'tolerant', label: 'Tolerant' },
            { value: 'normal', label: 'Normal' },
            { value: 'strict', label: 'Streng' },
          ]}
        />
      </div>

      <h3 className="tt-section-title">
        <Target size={15} /> Bewertung
      </h3>
      <Slider label="Toleranz" value={s.tolerance} min={10} max={50} step={5} onChange={(v) => onChange({ tolerance: v })} format={(v) => `± ${v} Cent`} />
      <Switch checked={s.ignoreOctave} onChange={(v) => onChange({ ignoreOctave: v })} label="Oktave egal" />

      <h3 className="tt-section-title">Üben</h3>
      <Switch checked={s.countIn} onChange={(v) => onChange({ countIn: v })} label="Einzählen" />
      <Switch checked={s.refTone} onChange={(v) => onChange({ refTone: v })} label="Ton vorspielen im Warte-Modus" />
      <div className="tt-field tt-field--row">
        <span className="tt-field__label">Notennamen</span>
        <Segmented
          size="sm"
          label="Notennamen"
          value={s.naming}
          onChange={(v) => onChange({ naming: v })}
          options={[
            { value: 'de', label: 'C D E … H' },
            { value: 'intl', label: 'C D E … B' },
          ]}
        />
      </div>
      <Slider label="Kammerton A4" value={s.a4} min={430} max={446} onChange={(v) => onChange({ a4: v })} format={(v) => `${v} Hz`} />
    </Dialog>
  )
}

const pct = (v: number) => `${Math.round(v * 100)} %`

export function ResultsDialog({
  open,
  onClose,
  session,
  previous,
  colors,
  onLoopMeasure,
  onOpenProgress,
}: {
  open: boolean
  onClose: () => void
  session: SessionRecord | null
  previous: SessionRecord | null
  colors: TrainerColors
  onLoopMeasure: (measureIndex: number) => void
  onOpenProgress?: () => void
}) {
  if (!session) return <Dialog open={false} onClose={onClose} title="" children={null} />
  const measures = Object.entries(session.measures)
    .map(([k, m]) => ({ mi: Number(k), ...m, acc: m.n ? m.score / m.n : 0 }))
    .sort((a, b) => a.mi - b.mi)
  const problems = measures.filter((m) => m.acc < 0.7).sort((a, b) => a.acc - b.acc).slice(0, 4)
  const delta = previous && previous.notes ? session.accuracy - previous.accuracy : null

  return (
    <Dialog open={open} onClose={onClose} title="Auswertung" wide>
      <div className="tt-result__summary">
        <div>
          <p className="tt-result__score" style={{ color: accuracyColor(colors, session.accuracy) }}>
            {pct(session.accuracy)}
          </p>
          <p className="tt-muted">
            der Noten getroffen ({session.notes} bewertet, {session.trackName})
          </p>
        </div>
        {delta !== null && (
          <p className="tt-result__delta" style={{ color: delta >= 0 ? colors.tune : colors.sharp }}>
            {delta >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
            {delta >= 0 ? '+' : '−'}
            {Math.abs(Math.round(delta * 100))} Punkte zum letzten Mal
          </p>
        )}
      </div>

      {measures.length > 0 && (
        <>
          <h3 className="tt-section-title">Takt für Takt</h3>
          <div className="tt-result__measures">
            {measures.map((m) => (
              <button
                key={m.mi}
                onClick={() => onLoopMeasure(m.mi)}
                className="tt-result__measure"
                style={{ background: accuracyColor(colors, m.acc) }}
                title={`Takt ${m.label}: ${pct(m.acc)}. Klicken zum Üben.`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </>
      )}

      {problems.length > 0 && (
        <>
          <h3 className="tt-section-title">Hier lohnt sich Üben</h3>
          <ul className="tt-result__problems">
            {problems.map((m) => {
              const bias = m.biasN ? m.biasSum / m.biasN : 0
              return (
                <li key={m.mi} className="tt-result__problem">
                  <span>
                    <strong>Takt {m.label}</strong> <span style={{ color: accuracyColor(colors, m.acc) }}>{pct(m.acc)}</span>
                    {Math.abs(bias) > 12 && (
                      <span className="tt-result__bias">
                        {bias < 0 ? <ArrowUp size={14} color={colors.flat} /> : <ArrowDown size={14} color={colors.sharp} />}
                        meist {bias < 0 ? 'zu tief' : 'zu hoch'} (Ø {Math.round(Math.abs(bias))} Cent)
                      </span>
                    )}
                    {m.silent > m.n / 2 && <span className="tt-result__bias">oft nicht gesungen</span>}
                  </span>
                  <button className="tt-btn" onClick={() => onLoopMeasure(m.mi)}>
                    <Repeat size={16} /> Üben
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <div className="tt-actions tt-actions--end">
        {onOpenProgress && (
          <button className="tt-btn" onClick={onOpenProgress}>
            Fortschritt über Zeit
          </button>
        )}
        <button className="tt-btn tt-btn--primary" onClick={onClose}>
          Weiter üben
        </button>
      </div>
    </Dialog>
  )
}
