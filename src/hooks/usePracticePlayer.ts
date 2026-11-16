import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { pieceFileUrl } from '@/lib/pieceFiles';
import { track as trackEvent } from '@/lib/analytics';
import { barIndexAt, resolveBars, syncedDuration, type PlayedBar } from '@/lib/pieceTimeline';
import { PlaybackEngine, playbackSupported, type SourceStatus } from '@/lib/playback/engine';
import type { Piece } from '@/types';
import type { PlayerTrack } from '@/lib/pieceFiles';

export const PLAYBACK_RATES = [0.5, 0.6, 0.75, 0.9, 1, 1.1, 1.25];

const METRONOME_KEY = 'mediorchor.metronome';
const mixKey = (pieceId: string) => `mediorchor.mix.${pieceId}`;
const DEFAULT_VOLUME = 0.8;
// The metronome's level among the mixer settings.
const METRONOME_CHANNEL = '__metronome';

// A loop section in played-bar indices (inclusive).
export interface LoopRange {
  from: number;
  to: number;
}

// A voice's setting in the mixer.
export interface ChannelSetting {
  on: boolean;
  volume: number; // 0…1
}

// A voice as the mixer shows it.
export interface MixerVoice extends ChannelSetting {
  id: string;
  title: string;
  status: SourceStatus;
  progress: number;
  // Carries the metronome click right now.
  click: boolean;
}

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
};

// A voice's recordings for the mixer: the plain one (the voice alone, else
// the closest there is) and, when there is one, the same with the click.
// "Others quiet" mixes are only a fallback now: the mixer sets the others.
const voiceRecordings = (track: PlayerTrack) => {
  const r = track.recordings;
  const plain = r.file_id ?? r.quiet_file_id ?? r.click_file_id ?? r.quiet_click_file_id ?? null;
  const click = r.click_file_id ?? r.quiet_click_file_id ?? null;
  const plainHasClick = plain != null && (plain === r.click_file_id || plain === r.quiet_click_file_id);
  return { plain, click, plainHasClick };
};

const DEFAULT_CHANNEL: ChannelSetting = { on: true, volume: DEFAULT_VOLUME };

// Perceived loudness follows the slider better squared.
const gainOf = (c: ChannelSetting) => (c.on ? c.volume * c.volume : 0);

// Practice playback of a piece: all its voices mixed in sync (each switched
// on or off and at its own volume), the metronome click, bar-accurate jumps,
// a loop section, slower or faster with the pitch kept, and the phone's
// lock-screen controls. See src/lib/playback/engine.ts.
export const usePracticePlayer = (piece: Piece | null, tracks: PlayerTrack[]) => {
  const [engine, setEngine] = useState<PlaybackEngine | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const supported = useMemo(() => playbackSupported(), []);

  useEffect(() => {
    if (!supported) return;
    const e = new PlaybackEngine();
    e.onChange = rerender;
    setEngine(e);
    return () => {
      e.onChange = () => undefined;
      e.destroy();
    };
  }, [supported]);

  // Mixer settings, remembered per piece and browser.
  const pieceId = piece?.id ?? '';
  const [channels, setChannels] = useState<Record<string, ChannelSetting>>({});
  useEffect(() => {
    if (pieceId) setChannels(readJson(mixKey(pieceId), {}));
  }, [pieceId]);
  const channelOf = useCallback((id: string): ChannelSetting => channels[id] ?? DEFAULT_CHANNEL, [channels]);
  const updateChannels = useCallback(
    (fn: (prev: Record<string, ChannelSetting>) => Record<string, ChannelSetting>) => {
      setChannels((prev) => {
        const next = fn(prev);
        if (pieceId) writeJson(mixKey(pieceId), next);
        return next;
      });
    },
    [pieceId],
  );

  const [metronomeOn, setMetronomeOnState] = useState(() => readJson<number>(METRONOME_KEY, 1) !== 0);
  const setMetronomeOn = useCallback((on: boolean) => {
    setMetronomeOnState(on);
    writeJson(METRONOME_KEY, on ? 1 : 0);
  }, []);

  // Which recording each voice plays. With the metronome on, one heard
  // voice that has a click version plays that (the loudest one), so the
  // click is there once, whatever is switched on.
  // Mixer mode: one recording per voice, the metronome a track of its own.
  const mixerMode = piece?.track_mode === 'mixer';
  const voiceTracks = useMemo(() => tracks.filter((t) => t.kind !== 'click'), [tracks]);
  const clickTrack = mixerMode ? (tracks.find((t) => t.kind === 'click' && t.recordings.file_id) ?? null) : null;
  const recordings = useMemo(
    () =>
      voiceTracks.map((t) => {
        const r = voiceRecordings(t);
        // Mixer mode has no click versions: never swap one in.
        return mixerMode ? { track: t, ...r, click: null } : { track: t, ...r };
      }),
    [voiceTracks, mixerMode],
  );
  const carrier = useMemo(() => {
    if (!metronomeOn || mixerMode) return null;
    let best: { id: string; volume: number } | null = null;
    for (const r of recordings) {
      const c = channelOf(r.track.id);
      if (!r.click || r.plainHasClick || !c.on || c.volume <= 0) continue;
      if (!best || c.volume > best.volume) best = { id: r.track.id, volume: c.volume };
    }
    return best?.id ?? null;
  }, [metronomeOn, mixerMode, recordings, channelOf]);
  const metronomeAvailable = clickTrack != null || recordings.some((r) => r.click && !r.plainHasClick);

  // The metronome's level (0…1), in both modes. Mixer mode: the metronome
  // track's volume. Variants: a voice's recordings with and without click
  // are the same but for the click, so playing both in sync and fading
  // between them keeps the voice as loud and sets only the click (all the
  // way up: the recording with click, as before).
  const metronomeLevel = channels[METRONOME_CHANNEL]?.volume ?? (mixerMode ? DEFAULT_VOLUME : 1);
  const clickShare = metronomeLevel * metronomeLevel;
  const carrierClick = useMemo(() => {
    const r = recordings.find((x) => x.track.id === carrier);
    return r?.click ? pieceFileUrl(r.click) : null;
  }, [recordings, carrier]);
  const engineVoices = useMemo(() => {
    const voices = recordings.flatMap((r) => {
      const base = { leadIn: r.track.offset_s ?? 0 };
      const gain = gainOf(channelOf(r.track.id));
      const plain = { ...base, id: r.track.id, url: r.plain ? pieceFileUrl(r.plain) : null, gain };
      if (r.track.id !== carrier || !r.click) return [plain];
      return [
        { ...plain, gain: gain * (1 - clickShare) },
        { ...base, id: `${r.track.id}:click`, url: pieceFileUrl(r.click), gain: gain * clickShare },
      ];
    });
    // The metronome track: on with the metronome switch, at its own level.
    if (clickTrack?.recordings.file_id) {
      voices.push({
        id: clickTrack.id,
        url: pieceFileUrl(clickTrack.recordings.file_id),
        leadIn: clickTrack.offset_s ?? 0,
        gain: metronomeOn ? clickShare : 0,
      });
    }
    return voices;
  }, [recordings, carrier, channelOf, clickTrack, metronomeOn, clickShare]);

  const leadIn = engineVoices.reduce((m, v) => Math.max(m, v.leadIn), 0);
  // The piece lasts at least until its last bar ends.
  const timelineEnd = useMemo(() => {
    const d = syncedDuration(piece?.timeline ?? null, piece?.bar_sync ?? null);
    return d != null ? leadIn + d : 0;
  }, [piece?.timeline, piece?.bar_sync, leadIn]);

  useEffect(() => {
    if (!engine) return;
    engine.mono = engineVoices.length > 2;
    engine.setVoices(engineVoices, timelineEnd);
  }, [engine, engineVoices, timelineEnd]);

  const duration = engine?.duration ?? 0;
  const playing = engine?.playing ?? false;
  const waiting = engine?.waiting ?? false;
  const rate = engine?.rate ?? 1;

  const bars = useMemo(
    () => resolveBars(piece?.timeline ?? null, duration, leadIn, piece?.bar_shift ?? 0, piece?.bar_sync ?? null),
    [piece?.timeline, duration, leadIn, piece?.bar_shift, piece?.bar_sync],
  );

  // The position, smooth while playing.
  const [time, setTime] = useState(0);
  const enginePos = engine?.position ?? 0;
  useEffect(() => {
    if (!engine) return;
    if (!playing) {
      setTime(engine.position);
      return;
    }
    let raf = 0;
    const tick = () => {
      setTime(engine.position);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, playing, enginePos]);

  const currentIndex = barIndexAt(bars, time);
  const currentBar: PlayedBar | null = currentIndex >= 0 ? bars[currentIndex] : null;

  const [loop, setLoopState] = useState<LoopRange | null>(null);
  const live = useRef({ bars, loop, currentIndex, engine });
  live.current = { bars, loop, currentIndex, engine };

  // The loop section in seconds, again whenever the bars move.
  useEffect(() => {
    if (!engine) return;
    const from = loop ? bars[loop.from] : undefined;
    const to = loop ? bars[loop.to] : undefined;
    engine.setLoop(from && to ? { from: from.start, to: to.end } : null);
  }, [engine, loop, bars]);

  const setLoop = useCallback((range: LoopRange | null) => {
    // The live copy right away: a seek in the same handler sees it.
    live.current.loop = range;
    setLoopState(range);
    const { engine: e, bars: b } = live.current;
    const from = range ? b[range.from] : undefined;
    const to = range ? b[range.to] : undefined;
    e?.setLoop(from && to ? { from: from.start, to: to.end } : null);
  }, []);

  // Seeking out of the loop section ends the loop.
  const seek = useCallback(
    (t: number) => {
      const { engine: e, bars: b, loop: l } = live.current;
      if (!e) return;
      if (l && b[l.from] && b[l.to] && (t < b[l.from].start - 0.01 || t >= b[l.to].end)) setLoop(null);
      e.seek(Math.max(0, t));
      setTime(e.position);
    },
    [setLoop],
  );

  const playTracked = useRef(false);
  const voiceCount = voiceTracks.length;
  const play = useCallback(() => {
    const { engine: e, bars: b, loop: l } = live.current;
    if (!e) return;
    // Starting outside the loop section starts at its beginning.
    const now = e.position;
    if (l && b[l.from] && b[l.to] && (now < b[l.from].start || now >= b[l.to].end)) e.seek(b[l.from].start);
    e.play();
    if (!playTracked.current) {
      playTracked.current = true;
      trackEvent('practice-play', { voices: voiceCount > 4 ? '5+' : String(voiceCount) });
    }
  }, [voiceCount]);

  const pause = useCallback(() => live.current.engine?.pause(), []);

  const toggle = useCallback(() => {
    const e = live.current.engine;
    if (!e) return;
    if (e.playing || e.waiting) e.pause();
    else play();
  }, [play]);

  const playBar = useCallback(
    (index: number) => {
      const bar = live.current.bars[index];
      if (!bar) return;
      seek(bar.start);
      play();
    },
    [seek, play],
  );

  // Like a music player's "previous": back to the start of the current bar,
  // or to the previous bar when already right at its start.
  const prevBar = useCallback(() => {
    const { engine: e, bars: b, currentIndex: i } = live.current;
    if (!e || b.length === 0) return;
    if (i < 0) return seek(0);
    const intoBar = e.position - b[i].start;
    const target = intoBar > 0.6 * (e.rate || 1) || i === 0 ? i : i - 1;
    seek(b[target].start);
  }, [seek]);

  const nextBar = useCallback(() => {
    const { bars: b, currentIndex: i } = live.current;
    if (b.length === 0) return;
    seek(b[Math.min(b.length - 1, i + 1)].start);
  }, [seek]);

  const setRate = useCallback((value: number) => live.current.engine?.setRate(value), []);

  // Mixer.
  const mixerVoices: MixerVoice[] = recordings.map((r) => {
    const c = channelOf(r.track.id);
    const src = engine?.source(engineVoices.find((v) => v.id === r.track.id)?.url ?? null) ?? null;
    return {
      id: r.track.id,
      title: r.track.title,
      on: c.on,
      volume: c.volume,
      status: src?.status ?? 'loading',
      progress: src?.progress ?? 0,
      click: r.track.id === carrier || (r.plainHasClick && c.on),
    };
  });
  const setChannel = useCallback(
    (id: string, patch: Partial<ChannelSetting>) =>
      updateChannels((prev) => ({ ...prev, [id]: { ...(prev[id] ?? DEFAULT_CHANNEL), ...patch } })),
    [updateChannels],
  );
  // Only this voice on; pressed again: everyone on.
  const solo = useCallback(
    (id: string) =>
      updateChannels((prev) => {
        const alone = voiceTracks.every((t) => (t.id === id) === (prev[t.id]?.on ?? true));
        const next: Record<string, ChannelSetting> = {};
        for (const t of voiceTracks) next[t.id] = { ...(prev[t.id] ?? DEFAULT_CHANNEL), on: alone || t.id === id };
        // The metronome track keeps its level.
        if (prev[METRONOME_CHANNEL]) next[METRONOME_CHANNEL] = prev[METRONOME_CHANNEL];
        return next;
      }),
    [voiceTracks, updateChannels],
  );
  const resetMix = useCallback(() => updateChannels(() => ({})), [updateChannels]);
  const retry = useCallback(
    (id: string) => {
      const url = engineVoices.find((v) => v.id === id)?.url;
      if (url) engine?.retry(url);
    },
    [engine, engineVoices],
  );

  const metronomeUrl = clickTrack?.recordings.file_id ? pieceFileUrl(clickTrack.recordings.file_id) : carrierClick;
  const heard = mixerVoices.filter((v) => v.on && v.volume > 0);
  const loadingProgress =
    heard.length > 0 ? heard.reduce((s, v) => s + (v.status === 'loading' ? v.progress : 1), 0) / heard.length : 1;
  const soleTitle = heard.length === 1 ? heard[0].title : null;

  // Lock-screen / headset controls on phones.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !piece) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: piece.name,
      artist: [soleTitle, piece.composer].filter(Boolean).join(' · '),
    });
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', play],
      ['pause', pause],
      ['previoustrack', prevBar],
      ['nexttrack', nextBar],
      ['seekto', (d) => d.seekTime != null && seek(d.seekTime)],
    ];
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        /* unsupported action */
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          /* unsupported action */
        }
      }
    };
  }, [piece, soleTitle, play, pause, prevBar, nextBar, seek]);

  // Position on the lock screen; on state changes is enough (the system
  // runs it on by itself).
  const wholeSecond = Math.round(time);
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    if (duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({ duration, playbackRate: rate, position: Math.min(wholeSecond, duration) });
    } catch {
      /* unsupported */
    }
  }, [playing, rate, duration, wholeSecond]);

  return {
    supported: supported && !engine?.unsupported,
    bars,
    currentIndex,
    currentBar,
    time,
    duration,
    playing,
    // Play was pressed and waits for the heard voices to load.
    waiting,
    // 0…1: how far the heard voices are loaded.
    loadingProgress,
    play,
    pause,
    toggle,
    seek,
    playBar,
    prevBar,
    nextBar,
    rate,
    setRate,
    loop,
    setLoop,
    metronome: {
      on: metronomeOn,
      setOn: setMetronomeOn,
      // Some voice has a recording with click (and one without).
      available: metronomeAvailable,
      // The click is heard right now (a voice that is on carries it, or the
      // metronome track plays).
      audible: clickTrack ? metronomeOn : mixerVoices.some((v) => v.click),
      // Its level (both modes) and, while one is needed, its recording's
      // loading state.
      volume: metronomeLevel,
      setVolume: (volume: number) => setChannel(METRONOME_CHANNEL, { volume }),
      source: metronomeUrl
        ? {
            status: (engine?.source(metronomeUrl)?.status ?? 'loading') as SourceStatus,
            progress: engine?.source(metronomeUrl)?.progress ?? 0,
            retry: () => engine?.retry(metronomeUrl),
          }
        : null,
    },
    mixer: {
      voices: mixerVoices,
      setOn: (id: string, on: boolean) => setChannel(id, { on }),
      setVolume: (id: string, volume: number) => setChannel(id, volume > 0 ? { volume, on: true } : { volume }),
      solo,
      reset: resetMix,
      retry,
      // Something differs from everyone on at the default volume.
      changed: Object.keys(channels).length > 0,
    },
  };
};

export type PracticePlayer = ReturnType<typeof usePracticePlayer>;
