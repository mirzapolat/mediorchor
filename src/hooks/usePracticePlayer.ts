import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pieceFileUrl } from '@/lib/pieceFiles';
import { track as trackEvent } from '@/lib/analytics';
import { barIndexAt, resolveBars, type PlayedBar } from '@/lib/pieceTimeline';
import type { Piece, PieceFile } from '@/types';

export const PLAYBACK_RATES = [0.5, 0.6, 0.75, 0.9, 1, 1.1, 1.25];

const METRONOME_KEY = 'mediorchor.metronome';

// A loop section in played-bar indices (inclusive).
export interface LoopRange {
  from: number;
  to: number;
}

// Where to continue once another recording has loaded, and whether to keep
// playing: another voice restarts the bar (its lead-in and length may
// differ); the same voice with or without click continues at the exact time.
interface PendingSwitch {
  bar: number;
  time: number;
  resume: boolean;
  exact: boolean;
}

// Drives practice playback for a piece: one <audio> element that switches
// between the voice tracks while keeping the position, bar-accurate jumps,
// a loop section, playback speed, the recording with or without metronome
// click, and the phone's lock-screen controls.
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
  // Whether the click recordings are wanted; remembered per browser.
  const [metronomeOn, setMetronomeOn] = useState(() => {
    try {
      return localStorage.getItem(METRONOME_KEY) === '1';
    } catch {
      return false;
    }
  });

  const track = tracks.find((t) => t.id === trackId) ?? tracks[0] ?? null;
  const offset = track?.offset_s ?? 0;

  const bars = useMemo(
    () => resolveBars(piece?.timeline ?? null, duration, offset, piece?.bar_shift ?? 0),
    [piece?.timeline, duration, offset, piece?.bar_shift],
  );
  const currentIndex = barIndexAt(bars, time);
  const currentBar: PlayedBar | null = currentIndex >= 0 ? bars[currentIndex] : null;

  // The metronome is a second recording of the track with a click in it.
  const metronomeAvailable = Boolean(track?.click_file_path);
  const filePath = metronomeOn && track?.click_file_path ? track.click_file_path : track?.file_path;

  // Latest values for the event handlers / animation loop.
  const live = useRef({ bars, loop, currentIndex });
  live.current = { bars, loop, currentIndex };
  const pendingSwitch = useRef<PendingSwitch | null>(null);
  // Whether the current track's metadata (and so its bars) is known.
  const metaLoaded = useRef(false);
  const playTracked = useRef(false);

  // Load the selected recording; continue at the same musical position.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !filePath) return;
    const src = pieceFileUrl(filePath);
    if (audio.src.endsWith(src)) return;
    metaLoaded.current = false;
    audio.src = src;
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
    setDuration(0);
  }, [filePath]);

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
      metaLoaded.current = d > 0;
      setDuration(d);
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

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const { bars: b, loop: l } = live.current;
    // Starting outside the loop section starts at its beginning.
    if (l && b[l.from] && (audio.currentTime < b[l.from].start || audio.currentTime >= b[l.to].end)) {
      audio.currentTime = b[l.from].start;
    }
    void audio.play();
  }, []);

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
      void audioRef.current?.play();
    },
    [seek],
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

  // Remembers where to continue and stops until the next recording has loaded.
  const holdPosition = useCallback((exact: boolean) => {
    const audio = audioRef.current;
    if (!audio) return;
    pendingSwitch.current = {
      bar: live.current.currentIndex,
      time: audio.currentTime,
      resume: !audio.paused,
      exact,
    };
    audio.pause();
  }, []);

  // Switching voices restarts the current bar on the new track, just like
  // tapping it, so recording and bar display start in step.
  const selectTrack = useCallback(
    (id: string) => {
      if (id === track?.id) return;
      const next = tracks.find((t) => t.id === id);
      const nextPath = metronomeOn && next?.click_file_path ? next.click_file_path : next?.file_path;
      if (nextPath !== filePath) holdPosition(false);
      setTrackId(id);
    },
    [track?.id, tracks, metronomeOn, filePath, holdPosition],
  );

  // Runs once the new recording's bars are known.
  useEffect(() => {
    const target = pendingSwitch.current;
    const audio = audioRef.current;
    if (!target || !audio || !metaLoaded.current || duration <= 0) return;
    pendingSwitch.current = null;
    if (target.exact) {
      seek(Math.min(target.time, duration));
      if (target.resume) void audio.play();
      return;
    }
    const bar = bars[target.bar];
    if (bar && target.resume) return playBar(target.bar);
    seek(bar ? bar.start : Math.min(target.time, duration));
    if (target.resume) void audio.play();
  }, [bars, duration, playBar, seek]);

  const setRate = useCallback((value: number) => {
    setRateState(value);
    const audio = audioRef.current;
    if (!audio) return;
    // A newly loaded track starts at the default rate.
    audio.defaultPlaybackRate = value;
    audio.playbackRate = value;
    // Practice at a slower tempo keeps the pitch (default, but be explicit).
    audio.preservesPitch = true;
  }, []);

  // Both recordings share their timing, so the other one continues at the
  // exact same moment.
  const setMetronome = useCallback(
    (on: boolean) => {
      if (on === metronomeOn) return;
      if (track?.click_file_path) holdPosition(true);
      setMetronomeOn(on);
      try {
        localStorage.setItem(METRONOME_KEY, on ? '1' : '0');
      } catch {
        /* storage unavailable */
      }
    },
    [metronomeOn, track?.click_file_path, holdPosition],
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
      // The current track has a recording with click.
      available: metronomeAvailable,
    },
  };
};

export type PracticePlayer = ReturnType<typeof usePracticePlayer>;
