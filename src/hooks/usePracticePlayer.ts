import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pieceFileUrl } from '@/lib/pieceFiles';
import { track as trackEvent } from '@/lib/analytics';
import { barIndexAt, resolveBars, type PlayedBar } from '@/lib/pieceTimeline';
import { clicksFromBars, createAudioContext, runMetronome } from '@/lib/metronome';
import type { Piece, PieceFile } from '@/types';

export const PLAYBACK_RATES = [0.5, 0.6, 0.75, 0.9, 1, 1.1, 1.25];

const METRONOME_KEY = 'mediorchor.metronome';

// A loop section in played-bar indices (inclusive).
export interface LoopRange {
  from: number;
  to: number;
}

// Where playback was, in musical terms, so it can continue at the same spot
// on another track (whose lead-in and length may differ).
interface MusicalPosition {
  bar: number;
  fraction: number;
  time: number;
}

// Drives practice playback for a piece: one <audio> element that switches
// between the voice tracks while keeping the position, bar-accurate jumps,
// a loop section, playback speed, a metronome from the notation file, and
// the phone's lock-screen controls.
export const usePracticePlayer = (piece: Piece | null, tracks: PieceFile[]) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (audioRef.current === null && typeof Audio !== 'undefined') {
    audioRef.current = new Audio();
    audioRef.current.preload = 'metadata';
  }

  const [trackId, setTrackId] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState(1);
  const [loop, setLoopState] = useState<LoopRange | null>(null);
  // Whether the metronome is wanted; remembered per browser.
  const [metronomeOn, setMetronomeOn] = useState(() => {
    try {
      return localStorage.getItem(METRONOME_KEY) === '1';
    } catch {
      return false;
    }
  });
  const audioCtx = useRef<AudioContext | null>(null);

  const track = tracks.find((t) => t.id === trackId) ?? tracks[0] ?? null;
  const offset = track?.offset_s ?? 0;

  const bars = useMemo(
    () => resolveBars(piece?.timeline ?? null, duration, offset),
    [piece?.timeline, duration, offset],
  );
  const currentIndex = barIndexAt(bars, time);
  const currentBar: PlayedBar | null = currentIndex >= 0 ? bars[currentIndex] : null;

  // The metronome needs beats from a notation file and is off for
  // recordings that already have a click in them.
  const clicks = useMemo(() => clicksFromBars(bars), [bars]);
  const metronomeAvailable = clicks.length > 0;
  const trackHasClick = Boolean(track?.has_click);
  const metronome = metronomeOn && metronomeAvailable && !trackHasClick;

  // Latest values for the event handlers / animation loop.
  const live = useRef({ bars, loop, currentIndex });
  live.current = { bars, loop, currentIndex };
  const metronomeRef = useRef(metronomeOn);
  metronomeRef.current = metronomeOn;
  const pendingSeek = useRef<MusicalPosition | null>(null);
  const resumeAfterLoad = useRef(false);
  const playTracked = useRef(false);

  // Load the selected track; continue at the same musical position.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !track?.file_path) return;
    const src = pieceFileUrl(track.file_path);
    if (audio.src.endsWith(src)) return;
    audio.src = src;
    audio.playbackRate = rate;
    setDuration(0);
  }, [track?.file_path]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const checkLoop = () => {
      const { bars: b, loop: l } = live.current;
      if (!l || audio.paused || !b[l.to]) return;
      if (audio.currentTime >= b[l.to].end - 0.03) {
        audio.currentTime = b[l.from].start;
      }
    };

    const onMeta = () => {
      const d = Number.isFinite(audio.duration) ? audio.duration : 0;
      setDuration(d);
      const target = pendingSeek.current;
      pendingSeek.current = null;
      if (target) {
        // Bars for the new track are only known once its duration is.
        const nextBars = resolveBars(piece?.timeline ?? null, d, track?.offset_s ?? 0);
        const bar = nextBars[target.bar];
        audio.currentTime = bar
          ? bar.start + target.fraction * (bar.end - bar.start)
          : Math.min(target.time, d);
      }
      if (resumeAfterLoad.current) {
        resumeAfterLoad.current = false;
        void audio.play();
      }
    };
    const onTime = () => {
      checkLoop();
      setTime(audio.currentTime);
    };
    const onPlay = () => {
      setPlaying(true);
      // Once per piece visit, whether started by click, key or bar tap.
      if (!playTracked.current) {
        playTracked.current = true;
        trackEvent('practice-play');
      }
    };
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      const { bars: b, loop: l } = live.current;
      if (l && b[l.from]) {
        audio.currentTime = b[l.from].start;
        void audio.play();
      } else {
        setPlaying(false);
      }
    };

    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    // Smooth position while playing (timeupdate only fires ~4×/s); the
    // timeupdate handler keeps loops working when the screen is locked.
    let raf = 0;
    const tick = () => {
      if (!audio.paused) {
        checkLoop();
        setTime(audio.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('durationchange', onMeta);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, [piece?.timeline, track?.offset_s]);

  // Stop when leaving the page.
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio?.pause();
    };
  }, []);

  const setLoop = useCallback((range: LoopRange | null) => {
    // Update the live copy right away: a seek in the same handler must
    // already see the new section.
    live.current.loop = range;
    setLoopState(range);
  }, []);

  // Seeking out of the loop section ends the loop.
  const seek = useCallback(
    (t: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const { bars: b, loop: l } = live.current;
      if (l && b[l.from] && b[l.to] && (t < b[l.from].start - 0.01 || t >= b[l.to].end)) setLoop(null);
      audio.currentTime = Math.max(0, t);
      setTime(audio.currentTime);
    },
    [setLoop],
  );

  // Browsers only let audio start from a user gesture: wake the
  // metronome's audio context whenever playback is started by one.
  const wakeAudio = useCallback(() => {
    if (!metronomeRef.current) return;
    audioCtx.current ??= createAudioContext();
    void audioCtx.current?.resume();
  }, []);

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    wakeAudio();
    const { bars: b, loop: l } = live.current;
    // Starting outside the loop section starts at its beginning.
    if (l && b[l.from] && (audio.currentTime < b[l.from].start || audio.currentTime >= b[l.to].end)) {
      audio.currentTime = b[l.from].start;
    }
    void audio.play();
  }, [wakeAudio]);

  const pause = useCallback(() => audioRef.current?.pause(), []);

  const toggle = useCallback(() => {
    if (audioRef.current?.paused) play();
    else pause();
  }, [play, pause]);

  const playBar = useCallback(
    (index: number) => {
      const bar = live.current.bars[index];
      if (!bar) return;
      seek(bar.start);
      wakeAudio();
      void audioRef.current?.play();
    },
    [seek, wakeAudio],
  );

  // Like a music player's "previous": back to the start of the current bar,
  // or to the previous bar when already right at its start.
  const prevBar = useCallback(() => {
    const audio = audioRef.current;
    const { bars: b, currentIndex: i } = live.current;
    if (!audio || b.length === 0) return;
    if (i < 0) return seek(0);
    const intoBar = audio.currentTime - b[i].start;
    const target = intoBar > 0.6 * (audio.playbackRate || 1) || i === 0 ? i : i - 1;
    seek(b[target].start);
  }, [seek]);

  const nextBar = useCallback(() => {
    const { bars: b, currentIndex: i } = live.current;
    if (b.length === 0) return;
    const target = Math.min(b.length - 1, i + 1);
    seek(b[target].start);
  }, [seek]);

  const selectTrack = useCallback(
    (id: string) => {
      const audio = audioRef.current;
      if (!audio || id === track?.id) return;
      const { bars: b, currentIndex: i } = live.current;
      const bar = b[i];
      pendingSeek.current = {
        bar: i,
        fraction: bar ? (audio.currentTime - bar.start) / Math.max(0.001, bar.end - bar.start) : 0,
        time: audio.currentTime,
      };
      resumeAfterLoad.current = !audio.paused;
      audio.pause();
      setTrackId(id);
    },
    [track?.id],
  );

  const setRate = useCallback((value: number) => {
    setRateState(value);
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = value;
    // Practice at a slower tempo keeps the pitch (default, but be explicit).
    audio.preservesPitch = true;
  }, []);

  const setMetronome = useCallback((on: boolean) => {
    metronomeRef.current = on;
    setMetronomeOn(on);
    if (on) wakeAudio();
    try {
      localStorage.setItem(METRONOME_KEY, on ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }, [wakeAudio]);

  // Clicks run alongside playback; restarted on any change of beats/track.
  useEffect(() => {
    const audio = audioRef.current;
    if (!metronome || !playing || !audio) return;
    audioCtx.current ??= createAudioContext();
    const ctx = audioCtx.current;
    if (!ctx) return;
    void ctx.resume();
    return runMetronome(ctx, audio, clicks, () => {
      const { bars: b, loop: l } = live.current;
      return l && b[l.to] ? b[l.to].end : null;
    });
  }, [metronome, playing, clicks]);

  useEffect(
    () => () => {
      void audioCtx.current?.close();
      audioCtx.current = null;
    },
    [],
  );

  // Lock-screen / headset controls on phones.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !piece) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: piece.name,
      artist: [track?.title, piece.composer].filter(Boolean).join(' · '),
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
  }, [piece, track?.title, play, pause, prevBar, nextBar, seek]);

  return {
    track,
    selectTrack,
    bars,
    currentIndex,
    currentBar,
    time,
    duration,
    playing,
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
      setOn: setMetronome,
      // Beats known for this piece / the current track already clicks.
      available: metronomeAvailable,
      trackHasClick,
    },
  };
};

export type PracticePlayer = ReturnType<typeof usePracticePlayer>;
