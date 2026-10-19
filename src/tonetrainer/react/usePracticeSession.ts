import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Mic } from '../core/audio/mic'
import { Player, type Channel } from '../core/audio/player'
import { audioContext, setOutputDevice } from '../core/audio/synth'
import { PracticeEngine, type EngineConfig, type Live, type Mode } from '../core/engine'
import { parseScore, type ParsedScore } from '../core/musicxml/parse'
import { CLARITY, type PracticeSettings } from '../core/settings'
import type { PracticeStorage } from '../core/storage'
import { Timeline } from '../core/timeline'
import type { SessionRecord } from '../core/types'
import type { ScoreHandle } from './ScoreView'
import { paperGradeColor, type TrainerColors } from './theme'

export type MicState = 'off' | 'starting' | 'on' | 'error'

export interface PracticeSessionOptions {
  /** ID of the score in the host app; sessions and prefs are stored under it. */
  scoreId: string
  /** MusicXML of the score (use readScoreFile() for .mxl uploads). */
  xml: string
  storage: PracticeStorage
  settings: PracticeSettings
  /** Phone layout (< 1024 px): separate zoom, own-voice-only score by default. */
  compact: boolean
  colors: TrainerColors
  /** 0-based source measure to loop right away (deep link from the progress view). */
  initialLoopMeasure?: number
  /** The voices the singer may pick (the host's group mapping); empty or omitted = all. One = no choice. */
  allowedTrackIds?: string[]
  /** Usage analytics of the host (small fixed values only, never names or ids). */
  onTrack?: (event: string, data?: Record<string, string | number | boolean>) => void
}

// Coarse buckets, so analytics only ever see a few fixed values.
const accuracyBucket = (a: number) => (a >= 0.8 ? '80-100' : a >= 0.5 ? '50-79' : '0-49')
const tempoBucket = (f: number) => (f < 0.95 ? 'slower' : f > 1.05 ? 'faster' : 'normal')

const SILENT_LIVE: Live = { sung: null, target: null, cents: null, inTune: false, levelDb: -100, blocked: false, beat: 0, hold: 0 }

/** Mixer preset ids, see presetMix(). */
export type MixPreset = 'learn' | 'firm' | 'alone' | 'solo'

export const MIX_PRESETS: { id: MixPreset; label: string; hint: string; own: Partial<Channel>; others: Partial<Channel> }[] = [
  { id: 'learn', label: 'Lernen', hint: 'Deine Stimme laut, die anderen leise', own: { volume: 0.95, muted: false }, others: { volume: 0.45, muted: false } },
  { id: 'firm', label: 'Festigen', hint: 'Deine Stimme leise als Stütze', own: { volume: 0.35, muted: false }, others: { volume: 0.85, muted: false } },
  { id: 'alone', label: 'Allein', hint: 'Nur die anderen, du singst deine Stimme', own: { muted: true }, others: { volume: 0.85, muted: false } },
  { id: 'solo', label: 'Nur meine', hint: 'Nur deine Stimme', own: { volume: 0.95, muted: false }, others: { muted: true } },
]

export function presetMix(trackIds: string[], ownId: string, preset: MixPreset = 'learn'): Record<string, Channel> {
  const p = MIX_PRESETS.find((x) => x.id === preset)!
  return Object.fromEntries(trackIds.map((id) => [id, { volume: 0.8, muted: false, solo: false, ...(id === ownId ? p.own : p.others) }]))
}

export function activePreset(trackIds: string[], ownId: string, mixer: Record<string, Channel>) {
  return (
    MIX_PRESETS.find((p) => {
      const ref = presetMix(trackIds, ownId, p.id)
      return Object.keys(ref).every((k) => mixer[k] && Math.abs(ref[k].volume - mixer[k].volume) < 0.005 && ref[k].muted === mixer[k].muted && ref[k].solo === mixer[k].solo)
    }) ?? null
  )
}

/**
 * All behaviour of the training view, without any markup. The reference <PracticeView> is a thin
 * layout on top of this hook; a host with its own design system can build its own view the same way.
 */
export function usePracticeSession(o: PracticeSessionOptions) {
  const trackRef = useRef(o.onTrack)
  trackRef.current = o.onTrack
  const trackEvent = (event: string, data?: Record<string, string | number | boolean>) => trackRef.current?.(event, data)
  const { scoreId, xml, storage, settings, compact, colors } = o
  const [order, setOrder] = useState<number[] | null>(null)
  const [trackId, setTrackIdState] = useState<string | null>(null)
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [needsTrackPick, setNeedsTrackPick] = useState(false)
  const [mixer, setMixer] = useState<Record<string, Channel>>({})
  const [zoom, setZoom] = useState(compact ? 0.62 : 0.85)
  const [factor, setFactorState] = useState(1)
  const [engine, setEngine] = useState<PracticeEngine | null>(null)
  const [micState, setMicState] = useState<MicState>('off')
  const [micError, setMicError] = useState<string | null>(null)
  const [micLabel, setMicLabel] = useState('')
  const [currentVisit, setCurrentVisit] = useState(0)
  const [results, setResults] = useState<{ session: SessionRecord; previous: SessionRecord | null } | null>(null)
  const [, rerender] = useReducer((x: number) => x + 1, 0)

  const scoreRef = useRef<ScoreHandle>(null)
  const playerRef = useRef<Player | null>(null)
  const engineRef = useRef<PracticeEngine | null>(null)
  const micRef = useRef<Mic | null>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const colorsRef = useRef(colors)
  colorsRef.current = colors
  const savedMixRef = useRef<{ trackId?: string; mixer?: Record<string, Channel> }>({})

  const parsed = useMemo<{ score: ParsedScore | null; error: string | null }>(() => {
    try {
      return { score: parseScore(xml), error: null }
    } catch (e) {
      return { score: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [xml])
  const score = parsed.score
  const allowedIds = o.allowedTrackIds?.length ? o.allowedTrackIds : null
  const isAllowed = (id: string) => !allowedIds || allowedIds.includes(id)

  // Per-score preferences.
  useEffect(() => {
    let cancelled = false
    storage.getPrefs(scoreId).then((p) => {
      if (cancelled) return
      const z = compact ? p.zoomMobile : p.zoom
      if (z) setZoom(z)
      if (p.tempoFactor) setFactorState(p.tempoFactor)
      savedMixRef.current = { trackId: p.trackId, mixer: p.mixer }
      const pickable = parsed.score?.tracks.filter((t) => isAllowed(t.id)) ?? []
      if (p.trackId && pickable.some((t) => t.id === p.trackId)) setTrackIdState(p.trackId)
      // Only one voice to sing: no question.
      else if (pickable.length === 1) setTrackIdState(pickable[0].id)
      else setNeedsTrackPick(true)
      setPrefsLoaded(true)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoreId, storage])

  const timeline = useMemo(() => (score && order ? new Timeline(score, order) : null), [score, order])
  /** Pass to <ScoreView onLayout>: the measure play order (repeats, voltas) found by the engraver. */
  const onLayout = useCallback((o: number[]) => setOrder((prev) => (prev && prev.length === o.length && prev.every((v, i) => v === o[i]) ? prev : o)), [])

  useEffect(() => {
    if (!timeline) return
    const p = new Player(audioContext(), timeline)
    playerRef.current = p
    return () => {
      p.dispose()
      playerRef.current = null
    }
  }, [timeline])

  const saveSession = useCallback(
    (e: PracticeEngine) => {
      const s = e.summary(scoreId)
      e.resetSession()
      if (s) void storage.addSession(s)
      return s
    },
    [scoreId, storage],
  )

  const config = (): EngineConfig => {
    const s = settingsRef.current
    return { tolerance: s.tolerance, ignoreOctave: s.ignoreOctave, headphones: s.headphones, refTone: s.refTone, countIn: s.countIn }
  }

  useEffect(() => {
    const player = playerRef.current
    if (!timeline || !trackId || !player) return
    const e = new PracticeEngine(timeline, player, trackId, config())
    e.mic = micRef.current
    player.setFactor(factor)
    engineRef.current = e
    setEngine(e)
    // dev/simulated-singer.js sets this flag to reach the engine from the console.
    if ((window as { __TONETRAINER_DEBUG__?: boolean }).__TONETRAINER_DEBUG__) Object.assign(window, { __ttEngine: e })
    const off = e.on((ev) => {
      if (ev.type === 'graded') {
        const n = e.notes[ev.idx]
        scoreRef.current?.colorNote(e.track.partIndex, e.track.voice, n.measureIndex, n.offsetQ, ev.grade ? paperGradeColor(colorsRef.current, ev.grade) : null)
      } else if (ev.type === 'finished') {
        const s = saveSession(e)
        if (s) {
          trackEvent('training-finish', { mode: s.mode, accuracy: accuracyBucket(s.accuracy), tempo: tempoBucket(s.tempoFactor) })
          storage.sessions(scoreId).then((all) => {
            const previous = all.filter((x) => x.trackId === s.trackId && x.id !== s.id && x.notes > 0).slice(-1)[0] ?? null
            setResults({ session: s, previous })
          })
        }
        rerender()
      } else rerender()
    })
    return () => {
      off()
      saveSession(e)
      e.dispose()
      engineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, trackId])

  useEffect(() => {
    if (!timeline || !trackId) return
    const saved = savedMixRef.current
    const ids = timeline.tracks.map((t) => t.id)
    setMixer(saved.mixer && saved.trackId === trackId && Object.keys(saved.mixer).length === ids.length ? saved.mixer : presetMix(ids, trackId))
  }, [timeline, trackId])

  useEffect(() => {
    playerRef.current?.setMix(mixer)
  }, [mixer, engine])

  useEffect(() => {
    if (!prefsLoaded || !trackId || !Object.keys(mixer).length) return
    savedMixRef.current = { trackId, mixer }
    const t = setTimeout(() => storage.savePrefs(scoreId, { trackId, mixer, tempoFactor: factor, [compact ? 'zoomMobile' : 'zoom']: zoom }), 400)
    return () => clearTimeout(t)
  }, [prefsLoaded, scoreId, storage, trackId, mixer, zoom, factor, compact])

  useEffect(() => {
    engine?.setConfig(config())
    const p = playerRef.current
    if (p) {
      p.a4 = settings.a4
      p.metronome = settings.metronome
    }
    micRef.current?.tracker.configure({ a4: settings.a4, minClarity: CLARITY[settings.sensitivity] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, settings.tolerance, settings.ignoreOctave, settings.headphones, settings.refTone, settings.countIn, settings.a4, settings.metronome, settings.sensitivity])

  const enableMic = useCallback(async () => {
    setMicState('starting')
    setMicError(null)
    const ctx = audioContext()
    await ctx.resume()
    micRef.current?.close()
    const s = settingsRef.current
    const opts = { deviceId: s.micDeviceId, echoCancellation: !s.headphones, a4: s.a4, minClarity: CLARITY[s.sensitivity] }
    try {
      let mic: Mic
      try {
        mic = await Mic.open(ctx, opts)
      } catch (err) {
        if (!s.micDeviceId || (err as Error).name !== 'OverconstrainedError') throw err
        mic = await Mic.open(ctx, { ...opts, deviceId: null })
      }
      micRef.current = mic
      if (engineRef.current) engineRef.current.mic = mic
      setMicLabel(mic.deviceLabel)
      setMicState('on')
      trackEvent('training-mic', { result: 'on', headphones: s.headphones })
      return true
    } catch (err) {
      const name = (err as Error).name
      trackEvent('training-mic', { result: name === 'NotAllowedError' ? 'denied' : name === 'NotFoundError' ? 'not-found' : 'error' })
      setMicError(
        name === 'NotAllowedError'
          ? 'Der Mikrofonzugriff wurde blockiert. Erlaube ihn in den Website-Einstellungen deines Browsers und versuche es erneut.'
          : name === 'NotFoundError'
            ? 'Es wurde kein Mikrofon gefunden.'
            : (err as Error).message,
      )
      setMicState('error')
      return false
    }
  }, [])

  // Device or headphone mode (echo cancellation) changed while the mic is on: reopen it.
  useEffect(() => {
    if (micState === 'on') void enableMic()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.micDeviceId, settings.headphones])

  useEffect(() => {
    void setOutputDevice(settings.outputDeviceId)
  }, [settings.outputDeviceId])

  useEffect(() => () => micRef.current?.close(), [])

  // Main loop: analyse audio, then move the score cursor.
  useEffect(() => {
    if (!engine) return
    let raf = 0
    let lastVisit = -1
    const loop = (now: number) => {
      engine.frame(now)
      const beat = engine.mode === 'play' ? engine.player.currentBeat() : (engine.notes[engine.waitIdx]?.startBeat ?? 0)
      const v = engine.timeline.visitAt(Math.max(0, beat))
      scoreRef.current?.setPosition(v.index, Math.max(0, beat) - v.startBeat)
      if (v.index !== lastVisit) {
        lastVisit = v.index
        setCurrentVisit(v.index)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [engine])

  const toggle = useCallback(async () => {
    const e = engineRef.current
    if (!e) return
    await audioContext().resume()
    if (!micRef.current && !(await enableMic())) return
    const starting = !e.running
    e.toggle()
    if (starting) trackEvent('training-play', { mode: e.mode, tempo: tempoBucket(e.player.factor) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableMic])

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== 'hidden' || !engineRef.current) return
      engineRef.current.pause()
      saveSession(engineRef.current)
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [saveSession])

  // Space = start/pause, R = reference tone, → = skip (wait mode).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement
      if (t.closest('input, select, textarea, dialog[open], [contenteditable]') || ev.metaKey || ev.ctrlKey) return
      const e = engineRef.current
      if (ev.code === 'Space') {
        ev.preventDefault()
        void toggle()
      } else if (ev.key === 'r' && e) e.playReference()
      else if (ev.key === 'ArrowRight' && e?.mode === 'wait') e.skip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  const setTrackId = useCallback((id: string) => {
    setNeedsTrackPick(false)
    setTrackIdState(id)
  }, [])

  const changeMode = useCallback(
    (m: Mode) => {
      const e = engineRef.current
      if (!e || e.mode === m) return
      e.pause()
      saveSession(e)
      e.setMode(m)
      trackEvent('training-mode', { mode: m })
    },
    [saveSession],
  )

  const loopMeasure = useCallback((mi: number) => {
    const e = engineRef.current
    if (!e) return
    setResults(null)
    const visit = e.timeline.visits.find((v) => v.measureIndex === mi)
    if (visit) e.setLoop({ startVisit: visit.index, endVisit: visit.index })
  }, [])

  const appliedInitialLoop = useRef(false)
  useEffect(() => {
    if (!engine || o.initialLoopMeasure === undefined || appliedInitialLoop.current) return
    appliedInitialLoop.current = true
    loopMeasure(o.initialLoopMeasure)
  }, [engine, o.initialLoopMeasure, loopMeasure])

  const setFactor = useCallback((f: number) => {
    setFactorState(f)
    engineRef.current?.player.setFactor(f)
  }, [])

  /** Clicking a measure in the score jumps to its next occurrence (repeats) from the current position. */
  const onMeasureClick = useCallback(
    (mi: number) => {
      const e = engineRef.current
      if (!e) return
      const candidates = e.timeline.visits.filter((v) => v.measureIndex === mi)
      const next = candidates.find((v) => v.index >= currentVisit) ?? candidates[0]
      if (next) e.seekToVisit(next.index)
    },
    [currentVisit],
  )

  return {
    score,
    parseError: parsed.error,
    timeline,
    engine,
    tracks: timeline?.tracks ?? [],
    /** The voices the singer can choose from (all tracks still play). */
    pickableTracks: (timeline?.tracks ?? []).filter((t) => isAllowed(t.id)),
    ownTrack: timeline && trackId ? (timeline.track(trackId) ?? null) : null,
    ownPartIndex: score?.tracks.find((t) => t.id === trackId)?.partIndex ?? 0,
    trackId,
    setTrackId,
    needsTrackPick: needsTrackPick && !!timeline,
    dismissTrackPick: () => {
      setNeedsTrackPick(false)
      const first = timeline?.tracks.find((t) => isAllowed(t.id))
      if (!trackId && first) setTrackIdState(first.id)
    },
    mode: (engine?.mode ?? 'play') as Mode,
    changeMode,
    running: engine?.running ?? false,
    loop: engine?.loop ?? null,
    setLoop: (l: { startVisit: number; endVisit: number } | null) => engineRef.current?.setLoop(l),
    loopMeasure,
    currentVisit,
    seekVisit: (v: number) => engineRef.current?.seekToVisit(v),
    restart: () => engineRef.current?.seekToVisit(engineRef.current.loop?.startVisit ?? 0),
    toggle,
    playReference: () => engineRef.current?.playReference(),
    skip: () => engineRef.current?.skip(),
    mixer,
    setMixer,
    zoom,
    setZoom,
    factor,
    setFactor,
    bpm: timeline && engine ? timeline.bpmAt(Math.max(0, engine.player.currentBeat())) : 0,
    micState,
    micError,
    micLabel,
    enableMic,
    results,
    closeResults: () => setResults(null),
    /** Stable getters for components that poll every animation frame. */
    getEngine: useCallback(() => engineRef.current, []),
    getLive: useCallback(() => engineRef.current?.live ?? SILENT_LIVE, []),
    scoreRef,
    onLayout,
    onMeasureClick,
  }
}

export type PracticeSession = ReturnType<typeof usePracticeSession>
