import { ArrowLeft, BarChart3, Headphones, Hourglass, Mic as MicIcon, Music2, Settings2, SlidersHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Mode } from '../core/engine'
import type { PracticeSettings } from '../core/settings'
import type { PracticeStorage } from '../core/storage'
import { HeadphonesPicker, MixerDialog, ResultsDialog, SettingsDialog, TrackPicker } from './dialogs'
import PianoRoll from './PianoRoll'
import ScoreView from './ScoreView'
import { DEFAULT_COLORS, useTrainerColors } from './theme'
import TransportBar from './TransportBar'
import Tuner from './Tuner'
import { Segmented } from './ui'
import { useLocalSettings } from './useLocalSettings'
import { usePracticeSession, type PracticeSession } from './usePracticeSession'

export interface PracticeViewProps {
  /** ID of the score in the host app. */
  scoreId: string
  title: string
  /** MusicXML string. */
  xml: string
  storage: PracticeStorage
  /** Omit both to use the built-in localStorage settings. */
  settings?: PracticeSettings
  onSettingsChange?: (patch: Partial<PracticeSettings>) => void
  /** 0-based source measure to loop on open (deep link from the progress view). */
  initialLoopMeasure?: number
  onBack?: () => void
  onOpenProgress?: () => void
  /** The host's current theme; a change re-reads the colours for canvas, SVG and score. */
  theme?: string
  /** The voices this singer may pick (empty or omitted = all); see usePracticeSession. */
  allowedTrackIds?: string[]
  /** Usage analytics of the host; see usePracticeSession. */
  onTrack?: (event: string, data?: Record<string, string | number | boolean>) => void
}

const COMPACT_QUERY = '(max-width: 1023px)'

export function useIsCompact() {
  const [compact, setCompact] = useState(() => matchMedia(COMPACT_QUERY).matches)
  useEffect(() => {
    const mq = matchMedia(COMPACT_QUERY)
    const on = () => setCompact(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return compact
}

/**
 * Reference training view. Layout (desktop): header / score (top left) / roll + lyrics (bottom left) /
 * tuner (right, full height) / transport bar. Phone: header / mode switch / score / compact tuner /
 * roll / transport. All behaviour lives in usePracticeSession().
 */
export default function PracticeView(props: PracticeViewProps) {
  const [localSettings, setLocalSettings] = useLocalSettings()
  const settings = props.settings ?? localSettings
  const setSettings = props.onSettingsChange ?? setLocalSettings
  const compact = useIsCompact()
  const rootRef = useRef<HTMLDivElement>(null)
  const themeColors = useTrainerColors(rootRef, [props.theme])
  const colors = themeColors ?? DEFAULT_COLORS
  const [mixerOpen, setMixerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [askHeadphones, setAskHeadphones] = useState(true)

  const s = usePracticeSession({
    scoreId: props.scoreId,
    xml: props.xml,
    storage: props.storage,
    settings,
    compact,
    colors,
    initialLoopMeasure: props.initialLoopMeasure,
    allowedTrackIds: props.allowedTrackIds,
    onTrack: props.onTrack,
  })

  if (s.parseError) {
    return (
      <div ref={rootRef} className="tt-root tt-error-page">
        <p className="tt-error-page__title">Die Partitur konnte nicht gelesen werden.</p>
        <p className="tt-muted">{s.parseError}</p>
        {props.onBack && (
          <button className="tt-btn tt-btn--primary" onClick={props.onBack}>
            Zurück
          </button>
        )}
      </div>
    )
  }

  const modeOptions = (short: boolean) => [
    { value: 'play' as Mode, label: short ? 'Mitsingen' : <><Music2 size={15} /> Mitsingen</> },
    { value: 'wait' as Mode, label: short ? 'Warten bis getroffen' : <><Hourglass size={15} /> Warten</> },
  ]
  const showAll = compact ? settings.showAllPartsMobile : settings.showAllParts

  return (
    <div ref={rootRef} className="tt-root tt-practice">
      <header className="tt-practice__header">
        {props.onBack && (
          <button className="tt-icon-btn" onClick={props.onBack} aria-label="Zurück">
            <ArrowLeft size={20} />
          </button>
        )}
        <h1 className="tt-practice__title">{props.title}</h1>
        {s.pickableTracks.length === 1 ? (
          <span className="tt-select tt-select--static tt-practice__track">{s.pickableTracks[0].name}</span>
        ) : s.pickableTracks.length > 0 && (
          <select className="tt-select tt-practice__track" value={s.trackId ?? ''} onChange={(e) => s.setTrackId(e.target.value)} aria-label="Deine Stimme">
            {!s.trackId && <option value="">Stimme wählen</option>}
            {s.pickableTracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <div className="tt-practice__mode tt-hide-compact">
          <Segmented<Mode> label="Übungsmodus" value={s.mode} onChange={s.changeMode} options={modeOptions(false)} />
        </div>
        <div className="tt-practice__tools">
          <button className="tt-icon-btn" onClick={() => setMixerOpen(true)} aria-label="Mixer" title="Mixer">
            <SlidersHorizontal size={20} />
          </button>
          {props.onOpenProgress && (
            <button className="tt-icon-btn" onClick={props.onOpenProgress} aria-label="Fortschritt" title="Fortschritt">
              <BarChart3 size={20} />
            </button>
          )}
          <button className="tt-icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Einstellungen" title="Einstellungen">
            <Settings2 size={20} />
          </button>
        </div>
      </header>
      <div className="tt-practice__mode-compact tt-only-compact">
        <Segmented<Mode> size="sm" label="Übungsmodus" value={s.mode} onChange={s.changeMode} options={modeOptions(true)} />
      </div>

      <main className="tt-practice__grid">
        <div className="tt-practice__score">
          {s.score && themeColors && (
            <ScoreView
              handle={s.scoreRef}
              xml={props.xml}
              ownPartIndex={s.ownPartIndex}
              showAllParts={showAll}
              zoom={s.zoom}
              colors={colors}
              onZoom={s.setZoom}
              onShowAllParts={(v) => setSettings(compact ? { showAllPartsMobile: v } : { showAllParts: v })}
              onLayout={s.onLayout}
              onMeasureClick={s.onMeasureClick}
            />
          )}
        </div>

        <div className="tt-practice__tuner">
          <Tuner getLive={s.getLive} tolerance={settings.tolerance} naming={settings.naming} micOn={s.micState === 'on'} waitMode={s.mode === 'wait'} colors={colors} compact={compact} />
        </div>

        <div className="tt-practice__roll tt-surface">
          <div className="tt-roll">
            <PianoRoll getEngine={s.getEngine} tolerance={settings.tolerance} ignoreOctave={settings.ignoreOctave} naming={settings.naming} colors={colors} onSeekVisit={s.seekVisit} />
          </div>
          {s.ownTrack?.notes.some((n) => n.lyric) && <Lyrics session={s} />}
          {s.micState !== 'on' && s.trackId && (
            <div className="tt-mic-gate">
              <div className="tt-mic-gate__box">
                <span className="tt-mic-gate__icon">
                  <MicIcon size={26} />
                </span>
                <p className="tt-mic-gate__title">Mikrofon aktivieren, um zu starten</p>
                <p className="tt-mic-gate__hint">
                  <Headphones size={15} /> Mit Kopfhörern hört das Mikrofon nur dich.
                </p>
                {s.micError && <p className="tt-mic-gate__error">{s.micError}</p>}
                <button className="tt-btn tt-btn--primary" onClick={() => void s.enableMic()} disabled={s.micState === 'starting'}>
                  {s.micState === 'starting' ? 'Warte auf Freigabe …' : 'Mikrofon aktivieren'}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {s.timeline && s.engine && (
        <TransportBar
          running={s.running}
          mode={s.mode}
          visits={s.timeline.visits}
          currentVisit={s.currentVisit}
          loop={s.loop}
          factor={s.factor}
          bpm={s.bpm}
          metronome={settings.metronome}
          onToggle={() => void s.toggle()}
          onRestart={s.restart}
          onFactor={s.setFactor}
          onLoop={s.setLoop}
          onMetronome={(v) => setSettings({ metronome: v })}
          onReference={s.playReference}
          onSkip={s.skip}
        />
      )}

      {/* First the headphones (they decide the microphone's filters), then the voice. */}
      <HeadphonesPicker
        open={askHeadphones}
        current={settings.headphones}
        onPick={(headphones) => {
          setSettings({ headphones })
          setAskHeadphones(false)
        }}
      />
      <TrackPicker open={s.needsTrackPick && !askHeadphones} tracks={s.pickableTracks} current={s.trackId} naming={settings.naming} onPick={s.setTrackId} onClose={s.dismissTrackPick} />
      {s.trackId && <MixerDialog open={mixerOpen} onClose={() => setMixerOpen(false)} tracks={s.tracks} ownId={s.trackId} mixer={s.mixer} onChange={s.setMixer} />}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} onChange={setSettings} micLabel={s.micLabel} />
      <ResultsDialog
        open={!!s.results}
        onClose={s.closeResults}
        session={s.results?.session ?? null}
        previous={s.results?.previous ?? null}
        colors={colors}
        onLoopMeasure={s.loopMeasure}
        onOpenProgress={props.onOpenProgress}
      />
    </div>
  )
}

/** The sung text around the current note, with the current syllable highlighted. */
function Lyrics({ session }: { session: PracticeSession }) {
  const { getEngine } = session
  const [idx, setIdx] = useState(-1)
  useEffect(() => {
    let raf = 0
    let last = -2
    const loop = () => {
      const e = getEngine()
      const i = e ? (e.mode === 'wait' ? e.waitIdx : (e.live.target?.idx ?? -1)) : -1
      if (i !== last) {
        last = i
        if (i >= 0) setIdx(i)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [getEngine])

  const e = getEngine()
  if (!e) return null
  const withLyrics = e.notes.filter((n) => n.lyric)
  const anchor = idx < 0 ? 0 : withLyrics.findIndex((n) => n.idx >= idx)
  const pos = anchor < 0 ? withLyrics.length - 1 : anchor
  const slice = withLyrics.slice(Math.max(0, pos - 4), pos + 10)
  const activeIdx = idx >= 0 && e.notes[idx]?.lyric ? idx : -1

  return (
    <p className="tt-lyrics">
      {slice.map((n) => (
        <span key={n.idx} className={n.idx === activeIdx ? 'tt-lyrics__current' : n.idx < idx ? 'tt-lyrics__past' : ''}>
          {n.lyric}
          {n.lyricJoin ? '' : ' '}
        </span>
      ))}
    </p>
  )
}
