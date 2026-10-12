import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, Loader2, Minus, Pause, Pin, PinOff, Play, Plus, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { pieceFileUrl } from '@/lib/pieceFiles';
import {
  MIN_BAR_SECONDS,
  barIndexAt,
  firstBarNumber,
  resolveBars,
  timelineLabels,
  validSyncPoints,
} from '@/lib/pieceTimeline';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import type { BarSyncPoint, Piece } from '@/types';

// A voice to listen to while syncing: one of its recordings and its lead-in.
export interface SyncVoice {
  id: string;
  title: string;
  path: string;
  offset: number;
}

interface BarSyncEditorProps {
  piece: Piece;
  voices: SyncVoice[];
  onClose: () => void;
  // The sync points, the lead-ins that changed (voice id → seconds) and
  // the bar numbering's shift.
  onSave: (sync: BarSyncPoint[], offsets: Record<string, number>, barShift: number) => Promise<void>;
}

const RATES = [0.5, 0.75, 1];
const MIN_PPS = 8;
const MAX_PPS = 600;
const PEAKS_PER_SECOND = 200;
// Seconds played before a bar picked to check it.
const PRE_ROLL = 1.5;

const audioContextClass = () =>
  window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

// Loudest sample per 1/200 s of a recording (all channels), scaled to 0…1.
const peaksCache = new Map<string, Promise<Float32Array | null>>();
const loadPeaks = (path: string): Promise<Float32Array | null> => {
  let pending = peaksCache.get(path);
  if (!pending) {
    pending = (async () => {
      const Ctx = audioContextClass();
      if (!Ctx) return null;
      const ctx = new Ctx();
      try {
        const response = await fetch(pieceFileUrl(path));
        const audio = await ctx.decodeAudioData(await response.arrayBuffer());
        const step = audio.sampleRate / PEAKS_PER_SECOND;
        const peaks = new Float32Array(Math.ceil(audio.length / step));
        for (let c = 0; c < audio.numberOfChannels; c++) {
          const data = audio.getChannelData(c);
          for (let i = 0; i < data.length; i++) {
            const v = Math.abs(data[i]);
            const k = Math.floor(i / step);
            if (v > peaks[k]) peaks[k] = v;
          }
        }
        let max = 0;
        for (const v of peaks) max = Math.max(max, v);
        if (max > 0) for (let k = 0; k < peaks.length; k++) peaks[k] /= max;
        return peaks;
      } catch {
        peaksCache.delete(path);
        return null;
      } finally {
        void ctx.close();
      }
    })();
    peaksCache.set(path, pending);
  }
  return pending;
};

// "1:23.45"
const formatPrecise = (s: number) => {
  const v = Math.max(0, s);
  const m = Math.floor(v / 60);
  return `${m}:${(v - m * 60).toFixed(2).padStart(5, '0')}`;
};

const cssColor = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// The fermata sign: an arc over a dot.
export const FermataIcon = ({ size = 14, className }: { size?: number; className?: string }) => (
  <svg width={size} height={(size * 10) / 16} viewBox="0 0 16 10" aria-hidden className={className}>
    <path d="M2 9.2A6 6 0 0 1 14 9.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <circle cx="8" cy="7.4" r="1.45" fill="currentColor" />
  </svg>
);

// Fits a piece's bars to its recordings where they leave the notation's
// timing: the recording as a waveform with the bars on top. Dragging a bar
// (or tapping along while it plays) pins when it really starts; the bars in
// between follow, extra time going to fermata bars first. Dragging bar one
// sets the voice's lead-in. A soft tick on every bar start lets you hear
// whether the bars sit right.
export const BarSyncEditor = ({ piece, voices, onClose, onSave }: BarSyncEditorProps) => {
  const { t } = useI18n();
  const [voiceId, setVoiceId] = useState(voices[0]?.id ?? '');
  const [sync, setSync] = useState<BarSyncPoint[]>(piece.bar_sync ?? []);
  const [offsets, setOffsets] = useState<Record<string, number>>(() =>
    Object.fromEntries(voices.map((v) => [v.id, v.offset])),
  );
  const [shift, setShift] = useState(piece.bar_shift ?? 0);
  const [selected, setSelected] = useState<number | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [clicks, setClicks] = useState(true);
  const [pps, setPps] = useState(60);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewWidth, setViewWidth] = useState(0);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [peaksState, setPeaksState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const voice = voices.find((v) => v.id === voiceId) ?? voices[0];
  const offset = offsets[voice.id] ?? 0;
  // The lead-in as last set, also between a drag's moves before a render.
  const offsetNow = useRef(offset);
  offsetNow.current = offset;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (audioRef.current === null) {
    audioRef.current = new Audio();
    audioRef.current.preload = 'auto';
  }
  const scrollerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clickCtx = useRef<AudioContext | null>(null);
  const dragging = useRef<{ bar: number; moved: boolean; x: number } | null>(null);

  const bars = useMemo(
    () => resolveBars(piece.timeline, duration, offset, shift, sync),
    [piece.timeline, duration, offset, shift, sync],
  );
  const points = useMemo(() => validSyncPoints(bars, sync), [bars, sync]);
  const pinned = useMemo(() => new Set(points.map((p) => p.bar)), [points]);
  const contentWidth = Math.max(viewWidth, duration * pps);
  const currentIndex = barIndexAt(bars, time);

  // Bar numbering: the first numbered bar as shown (number plus shift).
  const firstNumber = useMemo(() => firstBarNumber(timelineLabels(piece.timeline)), [piece.timeline]);

  const dirty =
    shift !== (piece.bar_shift ?? 0) ||
    JSON.stringify(points) !== JSON.stringify(validSyncPoints(bars, piece.bar_sync)) ||
    voices.some((v) => Math.abs((offsets[v.id] ?? 0) - v.offset) > 1e-4);

  // Latest values for the animation loop and the recording switch.
  const live = useRef({ bars, pinned, time, offset, clicks, pps, viewWidth });
  live.current = { bars, pinned, time, offset, clicks, pps, viewWidth };

  const flash = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((n) => (n === message ? null : n)), 2600);
  }, []);

  // Loads the voice's recording, continuing at the same musical position
  // (its lead-in may differ), and its waveform.
  const musicalTime = useRef<number | null>(null);
  useEffect(() => {
    const audio = audioRef.current!;
    const resume = !audio.paused;
    const at = musicalTime.current ?? 0;
    audio.pause();
    audio.src = pieceFileUrl(voice.path);
    audio.playbackRate = rate;
    audio.preservesPitch = true;
    const onMeta = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      audio.currentTime = Math.max(0, at + live.current.offset);
      setTime(audio.currentTime);
      if (resume) void audio.play();
    };
    audio.addEventListener('loadedmetadata', onMeta, { once: true });
    setPeaks(null);
    setPeaksState('loading');
    let cancelled = false;
    void loadPeaks(voice.path).then((p) => {
      if (cancelled) return;
      setPeaks(p);
      setPeaksState(p ? 'ready' : 'failed');
    });
    return () => {
      cancelled = true;
      audio.removeEventListener('loadedmetadata', onMeta);
      musicalTime.current = audio.currentTime - live.current.offset;
    };
    // Only when the recording changes.
  }, [voice.path]);

  useEffect(() => {
    const audio = audioRef.current!;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onPause);
    return () => {
      audio.pause();
      audio.removeAttribute('src');
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onPause);
      void clickCtx.current?.close();
    };
  }, []);

  // A short tick; bar one and pinned bars sound a little higher.
  const tick = useCallback((high: boolean) => {
    const ctx = clickCtx.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = high ? 1760 : 1320;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.07);
  }, []);

  // Playhead, bar ticks and following the playhead while playing.
  useEffect(() => {
    const audio = audioRef.current!;
    let raf = 0;
    let last = audio.currentTime;
    const loop = () => {
      const now = audio.currentTime;
      if (!audio.paused) {
        const { bars: b, pinned: pins, clicks: on, pps: scale, viewWidth: w } = live.current;
        // Only steady playback ticks (not a jump).
        if (on && now > last && now - last < 0.25) {
          for (let i = 0; i < b.length; i++) {
            if (b[i].start > last && b[i].start <= now) tick(i === 0 || pins.has(i));
          }
        }
        const scroller = scrollerRef.current;
        if (scroller && !dragging.current) {
          const x = now * scale;
          if (x < scroller.scrollLeft + w * 0.08 || x > scroller.scrollLeft + w * 0.78) {
            scroller.scrollLeft = x - w * 0.25;
          }
        }
        setTime(now);
      }
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tick]);

  // Viewport size.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(() => setViewWidth(scroller.clientWidth));
    observer.observe(scroller);
    setViewWidth(scroller.clientWidth);
    return () => observer.disconnect();
  }, []);

  // The visible part of the waveform (the canvas stays in view and is drawn
  // anew on scroll, zoom and playback), the played part darker.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || viewWidth <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const height = canvas.clientHeight;
    canvas.width = Math.round(viewWidth * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewWidth, height);
    const mid = height / 2;
    const played = cssColor('--color-text-secondary');
    const ahead = cssColor('--color-border-strong');
    ctx.fillStyle = ahead;
    ctx.fillRect(0, mid - 0.5, viewWidth, 1);
    if (!peaks) return;
    const playX = time * pps - scrollLeft;
    for (let x = 0; x < viewWidth; x++) {
      const k0 = Math.floor(((scrollLeft + x) / pps) * PEAKS_PER_SECOND);
      const k1 = Math.max(k0 + 1, Math.floor(((scrollLeft + x + 1) / pps) * PEAKS_PER_SECOND));
      if (k0 >= peaks.length) break;
      let v = 0;
      for (let k = k0; k < k1 && k < peaks.length; k++) v = Math.max(v, peaks[k]);
      const a = Math.max(0.5, v * (mid - 4));
      ctx.fillStyle = x < playX ? played : ahead;
      ctx.fillRect(x, mid - a, 1, a * 2);
    }
  }, [peaks, pps, scrollLeft, viewWidth, time]);

  const seek = useCallback((t: number) => {
    const audio = audioRef.current!;
    audio.currentTime = Math.max(0, Math.min(t, audio.duration || t));
    setTime(audio.currentTime);
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current!;
    // Created on a tap, so phones allow the ticks to sound.
    if (!clickCtx.current) {
      const Ctx = audioContextClass();
      if (Ctx) clickCtx.current = new Ctx();
    }
    void clickCtx.current?.resume();
    if (audio.paused) void audio.play();
    else audio.pause();
  }, []);

  // Keeps a time in view (e.g. a bar picked from the list).
  const reveal = useCallback(
    (t: number) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const x = t * pps;
      if (x < scroller.scrollLeft + 40 || x > scroller.scrollLeft + scroller.clientWidth - 40) {
        scroller.scrollTo({ left: x - scroller.clientWidth * 0.3, behavior: 'smooth' });
      }
    },
    [pps],
  );

  // Where bar `index` may start: after the pinned bar before it and before
  // the pinned bar after it, leaving every bar in between some length.
  const bounds = useCallback(
    (index: number): [number, number] => {
      if (index === 0) {
        const next = points[0]?.bar;
        return [0, next != null ? bars[next].start - MIN_BAR_SECONDS * next : duration];
      }
      let lo = 0;
      for (let i = index - 1; i > 0; i--) {
        if (pinned.has(i)) {
          lo = i;
          break;
        }
      }
      const hi = points.find((p) => p.bar > index)?.bar ?? null;
      const min = bars[lo].start + MIN_BAR_SECONDS * (index - lo);
      const max =
        hi != null
          ? bars[hi].start - MIN_BAR_SECONDS * (hi - index)
          : piece.timeline?.source === 'even'
            ? duration - MIN_BAR_SECONDS * (bars.length - index)
            : Math.max(duration, bars[bars.length - 1]?.end ?? 0);
      return [min, max];
    },
    [bars, points, pinned, duration, piece.timeline?.source],
  );

  // Pins bar `index` to start at recording time `t`. Bar one sets the
  // voice's lead-in instead, keeping the pinned bars where they are.
  const pin = useCallback(
    (index: number, t: number): boolean => {
      const bar = bars[index];
      if (!bar) return false;
      const [min, max] = bounds(index);
      if (t < min - 1e-6 || t > max + 1e-6) return false;
      const round = (s: number) => Math.round(s * 1000) / 1000;
      if (index === 0) {
        const delta = t - offsetNow.current;
        offsetNow.current = t;
        setOffsets((o) => ({ ...o, [voice.id]: round(t) }));
        setSync((s) => s.map((p) => ({ ...p, at: round(p.at - delta) })));
        return true;
      }
      setSync((s) => [...s.filter((p) => p.bar !== index), { bar: index, label: bar.label, at: round(t - offsetNow.current) }]);
      return true;
    },
    [bars, bounds, voice.id],
  );

  const unpin = useCallback((index: number) => {
    setSync((s) => s.filter((p) => p.bar !== index));
  }, []);

  const outOfOrder = useCallback(
    (index: number) => flash(t('syncOutOfOrder').replace('{bar}', bars[index]?.shown ?? '')),
    [bars, flash, t],
  );

  // Tap along: the selected bar (or the one nearest the playhead) starts
  // now; then the next bar is selected, so a passage can be tapped through.
  const tap = useCallback(() => {
    const now = audioRef.current!.currentTime;
    let index = selected;
    if (index == null) {
      let best = Infinity;
      bars.forEach((b, i) => {
        const d = Math.abs(b.start - now);
        if (d < best) {
          best = d;
          index = i;
        }
      });
    }
    if (index == null || !bars[index]) return;
    if (!pin(index, now)) return outOfOrder(index);
    setSelected(index + 1 < bars.length ? index + 1 : null);
  }, [selected, bars, pin, outOfOrder]);

  const nudge = useCallback(
    (index: number, by: number) => {
      const bar = bars[index];
      if (bar && !pin(index, bar.start + by)) outOfOrder(index);
    },
    [bars, pin, outOfOrder],
  );

  // Zoom keeping a time (default: the middle of the view) in place.
  const zoom = useCallback(
    (factor: number, anchorX?: number) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const x = anchorX ?? scroller.clientWidth / 2;
      const at = (scroller.scrollLeft + x) / pps;
      const next = Math.min(MAX_PPS, Math.max(MIN_PPS, pps * factor));
      setPps(next);
      requestAnimationFrame(() => {
        scroller.scrollLeft = at * next - x;
        setScrollLeft(scroller.scrollLeft);
      });
    },
    [pps],
  );

  // Ctrl/⌘ + wheel and trackpad pinch zoom; needs a non-passive listener.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = scroller.getBoundingClientRect();
      zoom(Math.exp(-e.deltaY * 0.01), e.clientX - rect.left);
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, [zoom]);

  // Selects a bar and moves just before it, ready to listen.
  const pick = useCallback(
    (index: number) => {
      const bar = bars[index];
      if (!bar) return;
      setSelected(index);
      seek(Math.max(0, bar.start - PRE_ROLL));
      reveal(bar.start);
    },
    [bars, seek, reveal],
  );

  const requestClose = useCallback(() => (dirty ? setConfirmClose(true) : onClose()), [dirty, onClose]);

  // Keys: space plays, T taps, arrows nudge, Backspace unpins, Escape
  // deselects (then closes), +/- zoom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (confirmClose || confirmReset || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        tap();
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && selected != null) {
        e.preventDefault();
        nudge(selected, (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01));
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && selected != null && pinned.has(selected)) {
        e.preventDefault();
        unpin(selected);
      } else if (e.key === 'Escape') {
        if (selected != null) setSelected(null);
        else requestClose();
      } else if (e.key === '+' || e.key === '=') {
        zoom(1.5);
      } else if (e.key === '-') {
        zoom(1 / 1.5);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, tap, nudge, unpin, zoom, selected, pinned, requestClose, confirmClose, confirmReset]);

  // The page behind doesn't scroll.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const timeAt = (clientX: number) => {
    const scroller = scrollerRef.current!;
    return (clientX - scroller.getBoundingClientRect().left + scroller.scrollLeft) / pps;
  };

  // A bar's chip: drag to pin the bar, tap to select it.
  const onHandleDown = (e: PointerEvent, index: number) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = { bar: index, moved: false, x: e.clientX };
  };
  const onHandleMove = (e: PointerEvent) => {
    const drag = dragging.current;
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x) < 4) return;
    drag.moved = true;
    const [min, max] = bounds(drag.bar);
    pin(drag.bar, Math.min(max, Math.max(min, timeAt(e.clientX))));
    setSelected(drag.bar);
  };
  const onHandleUp = () => {
    const drag = dragging.current;
    dragging.current = null;
    if (drag && !drag.moved) pick(drag.bar);
  };

  // Bars on screen (plus a margin), so long pieces stay light; labels that
  // would overlap at this zoom are left out (not pinned/selected/fermata ones).
  const visible = bars.filter((b) => b.end * pps >= scrollLeft - 80 && b.start * pps <= scrollLeft + viewWidth + 80);
  const averageBar = bars.length > 0 ? ((bars[bars.length - 1].end - bars[0].start) * pps) / bars.length : 1;
  const labelEvery = Math.max(1, Math.ceil(40 / Math.max(1, averageBar)));

  // Fermatas, each with whether the bar after it is pinned yet.
  const fermatas = bars
    .filter((b) => b.fermata && b.index + 1 < bars.length)
    .map((b) => ({ bar: b, next: bars[b.index + 1], done: pinned.has(b.index + 1) }));

  const selectedBar = selected != null ? (bars[selected] ?? null) : null;

  const save = async () => {
    setSaving(true);
    const changed = Object.fromEntries(
      voices.filter((v) => Math.abs((offsets[v.id] ?? 0) - v.offset) > 1e-4).map((v) => [v.id, offsets[v.id]]),
    );
    await onSave(points, changed, shift);
    setSaving(false);
  };

  const smallButton =
    'h-8 rounded-md border border-border px-2 text-xs font-medium tabular-nums text-text-secondary transition-colors duration-150 hover:bg-surface-hover hover:text-text';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-bg animate-[fadein_200ms_ease-in-out]"
      role="dialog"
      aria-modal="true"
      aria-label={t('syncTitle')}
    >
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border bg-surface px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={requestClose}
          aria-label={t('close')}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover hover:text-text"
        >
          <X size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{t('syncTitle')}</h2>
          <p className="truncate text-xs text-text-secondary">{piece.name}</p>
        </div>
        <Button onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          {t('save')}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-5">
          {voices.length > 1 ? (
            <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1">
              {voices.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVoiceId(v.id)}
                  className={cn(
                    'h-8 flex-shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors duration-150',
                    v.id === voice.id
                      ? 'border-black bg-black text-white'
                      : 'border-border bg-surface text-text-secondary hover:text-text',
                  )}
                >
                  {v.title || t('voiceName')}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex-1" />
          )}
          {firstNumber != null && (
            <label
              className="ml-auto flex flex-shrink-0 items-center gap-2 text-sm text-text-secondary"
              title={t('barNumberingHint')}
            >
              {t('barNumberingStart')}
              <NumberingInput value={firstNumber + shift} onChange={(v) => setShift(v - firstNumber)} />
            </label>
          )}
          <div className="flex flex-shrink-0 items-center gap-0.5 rounded-full bg-surface-hover p-0.5">
            <button
              type="button"
              onClick={() => zoom(1 / 1.5)}
              aria-label={t('zoomOut')}
              title={t('zoomOut')}
              className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary hover:bg-surface hover:text-text"
            >
              <Minus size={15} />
            </button>
            <button
              type="button"
              onClick={() => zoom(1.5)}
              aria-label={t('zoomIn')}
              title={t('zoomIn')}
              className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary hover:bg-surface hover:text-text"
            >
              <Plus size={15} />
            </button>
          </div>
          <p className="w-full text-sm text-text-secondary">{t('syncHelp')}</p>
        </div>

        {/* The recording with the bars on top */}
        <div className="relative mt-3 flex-shrink-0 border-y border-border bg-surface">
          <div
            ref={scrollerRef}
            onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
            className="overflow-x-auto overflow-y-hidden overscroll-x-contain"
          >
            <div className="relative h-52 pt-10 sm:h-64" style={{ width: contentWidth }}>
              <canvas
                ref={canvasRef}
                className="pointer-events-none sticky left-0 block h-full"
                style={{ width: viewWidth }}
              />
              {/* Tapping the waveform moves the playhead there. */}
              <div className="absolute inset-x-0 bottom-0 top-10 cursor-text" onClick={(e) => seek(timeAt(e.clientX))} />
              {visible.map((b) => {
                const i = b.index;
                const isPinned = i === 0 || pinned.has(i);
                const isSelected = selected === i;
                const showLabel = isPinned || isSelected || b.fermata || i % labelEvery === 0;
                return (
                  <div key={i}>
                    {b.fermata && (
                      <div
                        className="pointer-events-none absolute bottom-0 top-10 bg-accent/10"
                        style={{ left: b.start * pps, width: Math.max(1, (b.end - b.start) * pps) }}
                      />
                    )}
                    <div
                      className={cn(
                        'pointer-events-none absolute bottom-0 top-8',
                        isSelected ? 'w-0.5 bg-accent' : isPinned ? 'w-0.5 bg-black' : 'w-px bg-border-strong',
                      )}
                      style={{ left: b.start * pps - (isPinned || isSelected ? 1 : 0) }}
                    />
                    {showLabel && (
                      <button
                        type="button"
                        onPointerDown={(e) => onHandleDown(e, i)}
                        onPointerMove={onHandleMove}
                        onPointerUp={onHandleUp}
                        onPointerCancel={() => (dragging.current = null)}
                        aria-label={`${t('bar')} ${b.shown}${b.occurrences > 1 ? ` (${b.occurrence}.)` : ''}`}
                        title={t('syncDragHint')}
                        className={cn(
                          'absolute top-1.5 z-10 flex h-7 min-w-[1.75rem] -translate-x-1/2 cursor-ew-resize touch-none select-none items-center justify-center gap-0.5 whitespace-nowrap rounded-full px-1.5 text-xs font-semibold tabular-nums shadow-sm transition-colors duration-150',
                          isSelected
                            ? 'bg-accent text-white ring-2 ring-accent/30'
                            : isPinned
                              ? 'bg-black text-white'
                              : 'border border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text',
                        )}
                        style={{ left: b.start * pps }}
                      >
                        {isPinned && i > 0 && <Pin size={10} className="-ml-0.5" />}
                        {b.shown}
                        {b.occurrences > 1 && <sup className="text-[9px] font-medium">{b.occurrence}</sup>}
                        {b.fermata && <FermataIcon size={11} className="ml-0.5" />}
                      </button>
                    )}
                  </div>
                );
              })}
              <div className="pointer-events-none absolute bottom-0 top-8 w-0.5 bg-danger" style={{ left: time * pps - 1 }}>
                <div className="absolute -left-[3px] -top-1 h-2 w-2 rounded-full bg-danger" />
              </div>
            </div>
          </div>
          {peaksState !== 'ready' && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 top-10 flex items-center justify-center gap-2 text-sm text-text-secondary">
              {peaksState === 'loading' ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  {t('syncLoadingWave')}
                </>
              ) : (
                t('syncNoWave')
              )}
            </div>
          )}
          {notice && (
            <div className="pointer-events-none absolute left-1/2 top-12 z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-danger px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg">
              {notice}
            </div>
          )}
        </div>

        {/* Transport and tapping */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-5">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? t('pause') : t('play')}
            className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-black text-white shadow-sm transition-colors duration-150 hover:bg-black-hover"
          >
            {playing ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
          </button>
          <div className="min-w-[5.5rem]">
            <div className="text-lg font-semibold tabular-nums">{formatPrecise(time)}</div>
            <div className="text-xs tabular-nums text-text-secondary">
              {currentIndex >= 0 ? `${t('bar')} ${bars[currentIndex].shown}` : t('leadIn')}
            </div>
          </div>
          <button
            type="button"
            onClick={tap}
            className="order-last flex h-12 w-full items-center justify-center gap-2 rounded-full border-2 border-accent bg-accent/10 px-5 text-sm font-semibold transition-colors duration-150 hover:bg-accent/20 active:bg-accent/30 sm:order-none sm:w-auto"
          >
            <Pin size={15} />
            {selectedBar ? t('syncTapBar').replace('{bar}', selectedBar.shown) : t('syncTapNearest')}
            <kbd className="ml-1 hidden rounded border border-border bg-surface px-1.5 text-[10px] font-medium text-text-secondary sm:inline">
              T
            </kbd>
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={clicks}
                onChange={(e) => setClicks(e.target.checked)}
                className="h-4 w-4 accent-[var(--color-black)]"
              />
              {t('syncBarClicks')}
            </label>
            <div role="radiogroup" aria-label={t('playbackSpeed')} className="flex gap-0.5 rounded-full bg-surface-hover p-0.5">
              {RATES.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={r === rate}
                  onClick={() => {
                    setRate(r);
                    audioRef.current!.playbackRate = r;
                    audioRef.current!.preservesPitch = true;
                  }}
                  className={cn(
                    'h-8 rounded-full px-2.5 text-xs font-medium tabular-nums transition-colors duration-150',
                    r === rate ? 'bg-black text-white shadow-sm' : 'text-text-secondary hover:text-text',
                  )}
                >
                  {r}×
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-5 border-t border-border px-4 py-4 sm:px-5 lg:grid-cols-2">
          {/* The selected bar */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t('syncSelectedTitle')}</h3>
            {selectedBar && selected != null ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-2.5">
                <span className="flex h-8 min-w-[2rem] items-center justify-center rounded-full bg-accent px-2 text-sm font-semibold tabular-nums text-white">
                  {selectedBar.shown}
                </span>
                <div className="min-w-0">
                  <div className="text-sm tabular-nums">{formatPrecise(selectedBar.start)}</div>
                  <div className="text-xs text-text-secondary">
                    {selected === 0 ? t('syncIsLeadIn') : pinned.has(selected) ? t('syncPinned') : t('syncFollows')}
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-1">
                  {[-0.1, -0.01, 0.01, 0.1].map((by) => (
                    <button key={by} type="button" onClick={() => nudge(selected, by)} className={smallButton}>
                      {by > 0 ? '+' : '−'}
                      {Math.round(Math.abs(by) * 1000)} ms
                    </button>
                  ))}
                  {selected > 0 && pinned.has(selected) && (
                    <button
                      type="button"
                      onClick={() => unpin(selected)}
                      title={t('syncUnpin')}
                      aria-label={t('syncUnpin')}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover hover:text-text"
                    >
                      <PinOff size={15} />
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-text-secondary">{t('syncSelectHint')}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-text-secondary">
              <span>
                {pinned.size === 1 ? t('syncPinnedOne') : t('syncPinnedCount').replace('{n}', String(pinned.size))}
              </span>
              {pinned.size > 0 && (
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:text-text hover:underline"
                >
                  <RotateCcw size={12} />
                  {t('syncReset')}
                </button>
              )}
              <span className="hidden text-text-tertiary sm:inline">{t('syncKeys')}</span>
            </div>
          </div>

          {/* Fermatas: where the recording most likely leaves the notation */}
          <div className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <FermataIcon size={15} />
              {t('fermatas')}
            </h3>
            {fermatas.length === 0 ? (
              <p className="text-sm text-text-secondary">
                {piece.timeline?.source === 'notation' && piece.timeline.fermatas == null
                  ? t('syncFermatasUnknown')
                  : t('syncNoFermatas')}
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border bg-surface">
                {fermatas.map((f) => (
                  <li key={f.bar.index} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
                    <span className="min-w-0 flex-1">
                      {t('fermataInBar').replace('{bar}', f.bar.shown)}
                      {f.bar.occurrences > 1 && <span className="text-text-tertiary"> ({f.bar.occurrence}.)</span>}
                    </span>
                    {f.done && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-success-strong">
                        <Check size={13} />
                        {t('syncDone')}
                      </span>
                    )}
                    <button type="button" onClick={() => pick(f.next.index)} className={smallButton}>
                      {t('syncFermataGo').replace('{bar}', f.next.shown)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClose}
        title={t('syncDiscardTitle')}
        message={t('syncDiscardMessage')}
        confirmLabel={t('syncDiscard')}
        destructive
        onConfirm={onClose}
        onCancel={() => setConfirmClose(false)}
      />
      <ConfirmDialog
        open={confirmReset}
        title={t('syncReset')}
        message={t('syncResetMessage')}
        confirmLabel={t('syncReset')}
        destructive
        onConfirm={() => {
          setSync([]);
          setSelected(null);
          setConfirmReset(false);
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>,
    document.body,
  );
};

// The number of the first bar; applied while typing when it is a number,
// put back when left empty or invalid.
const NumberingInput = ({ value, onChange }: { value: number; onChange: (value: number) => void }) => {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      type="number"
      inputMode="numeric"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseInt(e.target.value, 10);
        if (Number.isFinite(v)) onChange(v);
      }}
      onBlur={() => setText(String(value))}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className="h-8 w-16 rounded-md border border-border bg-surface px-2 text-right text-base tabular-nums focus:border-black focus:outline-none sm:text-sm"
    />
  );
};
