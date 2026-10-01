import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Minus, Pause, Play, Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { pieceFileUrl } from '@/lib/pieceFiles';
import { resolveBars } from '@/lib/pieceTimeline';
import { createAudioContext, runMetronome, type Click } from '@/lib/metronome';
import type { Piece, PieceFile } from '@/types';

// Metronome placement (piece URL + `?metronome-debug`), as a full page over
// the app: the recording's waveform with every click drawn where it sounds.
// The clicks can be moved as a whole (down to 0.01 ms) while listening at
// reduced speed, and the shift saved for the practice view.

const HEIGHT = 220;
const RULER = 18;
const MIN_ZOOM = 10; // px per second
const MAX_ZOOM = 40000; // ~1 px per sample
// Browsers stop laying out elements somewhere past 33M px.
const MAX_WIDTH = 30_000_000;
const COARSE_RANGE = 2; // s
const FINE_RANGE = 0.025; // s
const RATES = [0.25, 0.5, 0.75, 1];
const NUDGES = [-10, -1, -0.1, 0.1, 1, 10]; // ms
const RULER_STEPS = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60];
// Waveform peaks are kept per block of samples for the zoomed-out views.
const BLOCK = 256;

// Theme token (e.g. --c-text = "26 26 26") as a canvas colour.
const token = (name: string, alpha = 1) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '0 0 0';
  return `rgb(${v} / ${alpha})`;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (s: number) => Math.round(s * 1e5) / 1e5; // 0.01 ms
const formatMs = (s: number) => `${s >= 0 ? '+' : '−'}${Math.abs(s * 1000).toFixed(2)} ms`;

// First index whose time is at or after `time`.
const lowerBound = (marks: { time: number }[], time: number) => {
  let lo = 0;
  let hi = marks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (marks[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

interface Mark extends Click {
  // Where the notation puts it, before the shift.
  base: number;
  // Bar number on the bar's first beat.
  bar: string | null;
}

interface Peaks {
  min: Float32Array;
  max: Float32Array;
}

const computePeaks = (buffer: AudioBuffer): Peaks => {
  const blocks = Math.ceil(buffer.length / BLOCK);
  const min = new Float32Array(blocks);
  const max = new Float32Array(blocks);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let b = 0; b < blocks; b++) {
      let lo = min[b];
      let hi = max[b];
      const end = Math.min(data.length, (b + 1) * BLOCK);
      for (let i = b * BLOCK; i < end; i++) {
        const v = data[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      min[b] = lo;
      max[b] = hi;
    }
  }
  return { min, max };
};

export const MetronomeDebug = ({
  piece,
  tracks,
  canSave,
  onSaved,
  onClose,
}: {
  piece: Piece;
  tracks: PieceFile[];
  canSave: boolean;
  onSaved: (shift: number) => void;
  onClose: () => void;
}) => {
  const [trackId, setTrackId] = useState(tracks[0]?.id ?? '');
  const track = tracks.find((t) => t.id === trackId) ?? tracks[0] ?? null;
  const offset = track?.offset_s ?? 0;

  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const savedShift = piece.metronome_shift ?? 0;
  const [shift, setShiftState] = useState(savedShift);
  // The fine slider moves around this point and re-centres when let go.
  const [fineCenter, setFineCenter] = useState(savedShift);
  const [shiftDraft, setShiftDraft] = useState<string | null>(null);
  const [zoom, setZoom] = useState(200);
  const [rate, setRate] = useState(0.5);
  const [clicksOn, setClicksOn] = useState(true);
  const [quiet, setQuiet] = useState(false);
  const [follow, setFollow] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [viewWidth, setViewWidth] = useState(0);

  const ctxRef = useRef<AudioContext | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const nearestRef = useRef<HTMLSpanElement>(null);
  const dirty = useRef(true);
  const pendingAnchor = useRef<{ time: number; x: number } | null>(null);

  const getCtx = () => (ctxRef.current ??= createAudioContext());

  const setShift = useCallback((value: number, recenter = true) => {
    const v = round(value);
    setShiftState(v);
    if (recenter) setFineCenter(v);
  }, []);

  // The page behind doesn't scroll while this one covers it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Recording: an <audio> element for playback, decoded samples for the waveform.
  useEffect(() => {
    if (!track?.file_path) return;
    const url = pieceFileUrl(track.file_path);
    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.preservesPitch = true;
    audioRef.current = audio;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onPause);

    setBuffer(null);
    setLoadError(null);
    let cancelled = false;
    void (async () => {
      try {
        const ctx = getCtx();
        if (!ctx) throw new Error('Kein Web Audio');
        const data = await (await fetch(url)).arrayBuffer();
        const decoded = await ctx.decodeAudioData(data);
        if (!cancelled) setBuffer(decoded);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      audio.pause();
      audio.removeAttribute('src');
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onPause);
      audioRef.current = null;
    };
  }, [track?.file_path]);

  useEffect(() => () => void ctxRef.current?.close(), []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = quiet ? 0.25 : 1;
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
  }, [quiet, rate, track?.file_path]);

  const peaks = useMemo(() => (buffer ? computePeaks(buffer) : null), [buffer]);
  const duration = buffer?.duration ?? 0;
  const bars = useMemo(
    () => resolveBars(piece.timeline, duration, offset, piece.bar_shift),
    [piece.timeline, duration, offset, piece.bar_shift],
  );

  // Every click, moved by the shift.
  const marks: Mark[] = useMemo(
    () =>
      bars.flatMap((b) =>
        b.beats.map((base, i) => ({
          base,
          time: base + shift,
          accent: i === 0 && b.downbeat,
          bar: i === 0 ? b.shown : null,
        })),
      ),
    [bars, shift],
  );

  const maxZoom = duration > 0 ? Math.min(MAX_ZOOM, MAX_WIDTH / duration) : MAX_ZOOM;
  const pxPerSec = clamp(zoom, MIN_ZOOM, Math.max(MIN_ZOOM, maxZoom));
  const width = Math.max(1, Math.ceil(duration * pxPerSec));

  // Everything the drawing loop needs, current as of the last render.
  const view = useRef({ buffer, peaks, marks, pxPerSec, offset, shift, follow });
  view.current = { buffer, peaks, marks, pxPerSec, offset, shift, follow };
  useEffect(() => {
    dirty.current = true;
  });

  // Keep the anchor (playhead or cursor) in place while zooming.
  const zoomTo = useCallback((next: number, anchorX?: number) => {
    const scroller = scrollRef.current;
    const { pxPerSec: px } = view.current;
    if (scroller) {
      let x = anchorX;
      if (x == null) {
        const head = (audioRef.current?.currentTime ?? 0) * px - scroller.scrollLeft;
        x = head >= 0 && head <= scroller.clientWidth ? head : scroller.clientWidth / 2;
      }
      pendingAnchor.current = { time: (scroller.scrollLeft + x) / px, x };
    }
    setZoom(clamp(next, MIN_ZOOM, MAX_ZOOM));
  }, []);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const anchor = pendingAnchor.current;
    pendingAnchor.current = null;
    if (scroller && anchor) scroller.scrollLeft = anchor.time * pxPerSec - anchor.x;
    dirty.current = true;
  }, [pxPerSec]);

  // Viewport width, and ctrl/⌘ + wheel (or pinch) to zoom at the cursor.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(() => setViewWidth(scroller.clientWidth));
    observer.observe(scroller);
    setViewWidth(scroller.clientWidth);
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const x = e.clientX - scroller.getBoundingClientRect().left;
      zoomTo(view.current.pxPerSec * Math.exp(-e.deltaY * 0.01), x);
    };
    const onScroll = () => (dirty.current = true);
    scroller.addEventListener('wheel', onWheel, { passive: false });
    scroller.addEventListener('scroll', onScroll);
    return () => {
      observer.disconnect();
      scroller.removeEventListener('wheel', onWheel);
      scroller.removeEventListener('scroll', onScroll);
    };
  }, [zoomTo, buffer]);

  // Draws the visible part only, so any zoom works on long recordings.
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const scroller = scrollRef.current;
    const audio = audioRef.current;
    const { buffer: buf, peaks: pk, marks: ms, pxPerSec: px, offset: lead, shift: sh } = view.current;
    if (!canvas || !scroller || !buf || !pk) return;
    const w = scroller.clientWidth;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(HEIGHT * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(HEIGHT * dpr);
    }
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, HEIGHT);

    const left = scroller.scrollLeft;
    const t0 = left / px;
    const t1 = (left + w) / px;
    const xOf = (t: number) => t * px - left;
    const waveH = HEIGHT - RULER;
    const mid = waveH / 2;
    const sr = buf.sampleRate;
    const perPx = sr / px;

    // Waveform: min/max per pixel column, or the samples themselves when
    // zoomed in this far.
    g.fillStyle = token('--c-text-secondary', 0.6);
    g.strokeStyle = token('--c-text-secondary', 0.8);
    if (perPx >= 2) {
      for (let x = 0; x < w; x++) {
        const from = Math.floor((left + x) * perPx);
        const to = Math.min(buf.length, Math.floor((left + x + 1) * perPx));
        if (from >= buf.length) break;
        let lo = 0;
        let hi = 0;
        if (perPx >= BLOCK * 2) {
          for (let b = Math.floor(from / BLOCK); b < Math.ceil(to / BLOCK); b++) {
            if (pk.min[b] < lo) lo = pk.min[b];
            if (pk.max[b] > hi) hi = pk.max[b];
          }
        } else {
          for (let c = 0; c < buf.numberOfChannels; c++) {
            const data = buf.getChannelData(c);
            for (let i = from; i < to; i++) {
              if (data[i] < lo) lo = data[i];
              if (data[i] > hi) hi = data[i];
            }
          }
        }
        g.fillRect(x, mid - hi * mid, 1, Math.max(1, (hi - lo) * mid));
      }
    } else {
      const data = buf.getChannelData(0);
      const from = Math.max(0, Math.floor(t0 * sr) - 1);
      const to = Math.min(buf.length, Math.ceil(t1 * sr) + 1);
      g.lineWidth = 1;
      g.beginPath();
      for (let i = from; i < to; i++) {
        const x = xOf(i / sr);
        const y = mid - data[i] * mid;
        if (i === from) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      if (perPx < 0.25) {
        for (let i = from; i < to; i++) g.fillRect(xOf(i / sr) - 1.5, mid - data[i] * mid - 1.5, 3, 3);
      }
    }
    g.fillStyle = token('--c-border-strong');
    g.fillRect(0, mid, w, 1);

    // Ruler.
    const step = RULER_STEPS.find((s) => s * px >= 90) ?? 60;
    const decimals = Math.max(0, -Math.floor(Math.log10(step)));
    g.fillStyle = token('--c-surface-muted');
    g.fillRect(0, waveH, w, RULER);
    g.fillStyle = token('--c-text-secondary');
    g.font = '10px system-ui, sans-serif';
    for (let k = Math.floor(t0 / step); k * step <= t1; k++) {
      const t = k * step;
      const x = Math.round(xOf(t));
      g.fillRect(x, waveH, 1, 5);
      g.fillText(`${t.toFixed(decimals)} s`, x + 3, HEIGHT - 4);
    }

    // The track's lead-in (bar one before the shift).
    g.strokeStyle = token('--c-success');
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(Math.round(xOf(lead)) + 0.5, 0);
    g.lineTo(Math.round(xOf(lead)) + 0.5, waveH);
    g.stroke();
    g.setLineDash([]);

    const margin = 200 / px;
    const first = lowerBound(ms, t0 - margin);
    const last = lowerBound(ms, t1 + margin);

    // Where the clicks were before the shift, faint.
    if (sh !== 0) {
      g.fillStyle = token('--c-text-secondary', 0.25);
      for (let i = first; i < last; i++) g.fillRect(Math.round(xOf(ms[i].base)), 0, 1, waveH);
    }

    // The clicks: downbeats red with the bar number, other beats blue; their
    // times when there is room.
    g.font = '11px system-ui, sans-serif';
    const timeDecimals = px >= 2000 ? 4 : 3;
    for (let i = first; i < last; i++) {
      const m = ms[i];
      const x = Math.round(xOf(m.time));
      g.fillStyle = m.accent ? token('--c-danger') : token('--c-chart-1', 0.9);
      g.fillRect(x - (m.accent ? 1 : 0), 0, m.accent ? 2 : 1, waveH);
      if (m.bar) {
        g.fillStyle = token('--c-danger');
        g.fillText(m.bar, x + 4, 12);
      }
      const gap = (ms[i + 1]?.time ?? Infinity) - m.time;
      if (gap * px > 64) {
        g.fillStyle = token('--c-text');
        g.fillText(m.time.toFixed(timeDecimals), x + 4, waveH - 6);
      }
    }

    // Playhead.
    if (audio) {
      g.fillStyle = token('--c-text');
      g.fillRect(Math.round(xOf(audio.currentTime)), 0, 1, waveH);
    }
  }, []);

  // Playhead, readouts, following and redraws.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const audio = audioRef.current;
      const scroller = scrollRef.current;
      if (audio) {
        const now = audio.currentTime;
        if (timeRef.current) timeRef.current.textContent = `${now.toFixed(3)} s`;
        const { marks: ms, pxPerSec: px, follow: fol } = view.current;
        if (nearestRef.current) {
          const i = lowerBound(ms, now);
          const near = [ms[i - 1], ms[i]]
            .filter(Boolean)
            .sort((a, b) => Math.abs(a.time - now) - Math.abs(b.time - now))[0];
          nearestRef.current.textContent = near
            ? `${near.time.toFixed(4)} s (${formatMs(near.time - now)} vom Abspielkopf)`
            : '–';
        }
        if (!audio.paused) {
          dirty.current = true;
          if (scroller && fol) {
            const x = now * px;
            if (x < scroller.scrollLeft || x > scroller.scrollLeft + scroller.clientWidth - 40) {
              scroller.scrollLeft = x - scroller.clientWidth * 0.2;
            }
          }
        }
      }
      if (dirty.current) {
        dirty.current = false;
        draw();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  // Clicks follow playback through the same scheduler as the player.
  useEffect(() => {
    const audio = audioRef.current;
    const ctx = ctxRef.current;
    if (!playing || !clicksOn || !audio || !ctx) return;
    void ctx.resume();
    return runMetronome(ctx, audio, marks, () => null);
  }, [playing, clicksOn, marks]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void getCtx()?.resume();
      void audio.play();
    } else {
      audio.pause();
    }
  }, []);

  // Space plays/pauses, arrows move the clicks (⇧ 10 ms, ⌥ 0.1 ms, else
  // 1 ms), Escape closes — here, not in the regular player behind this view.
  const shiftRef = useRef(shift);
  shiftRef.current = shift;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        e.stopImmediatePropagation();
        toggle();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopImmediatePropagation();
        const ms = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
        setShift(shiftRef.current + (e.key === 'ArrowLeft' ? -ms : ms) / 1000);
      } else if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [toggle, setShift, onClose]);

  // Click or drag in the waveform to seek.
  const seekAt = (clientX: number) => {
    const audio = audioRef.current;
    const scroller = scrollRef.current;
    if (!audio || !scroller) return;
    const rect = scroller.getBoundingClientRect();
    audio.currentTime = clamp((clientX - rect.left + scroller.scrollLeft) / pxPerSec, 0, duration);
    dirty.current = true;
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    const { error } = await api.from('pieces').update({ metronome_shift: shift }).eq('id', piece.id);
    setSaving(false);
    if (error) setSaveError(error.message);
    else onSaved(shift);
  };

  const unsaved = round(shift) !== round(savedShift);
  const commitDraft = () => {
    if (shiftDraft == null) return;
    const v = Number(shiftDraft.replace(',', '.').replace('−', '-'));
    if (Number.isFinite(v)) setShift(v / 1000);
    setShiftDraft(null);
  };

  const noBeats = piece.timeline?.source !== 'notation' || (buffer != null && marks.length === 0);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-bg">
      <div className="mx-auto max-w-screen-2xl space-y-4 px-4 pb-10 pt-4 sm:px-6">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            title="Schließen (Esc)"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-surface-muted"
          >
            <X size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold">Metronom ausrichten · {piece.name}</h1>
            <p className="text-sm text-text-secondary">
              Striche zeigen, wann die Klicks erklingen (rot: Taktanfang mit Taktnummer, blau: übrige Schläge,
              grau: ohne Verschiebung, grün gestrichelt: Vorlauf der Tonspur). Klick in die Wellenform springt
              dorthin. Leertaste: Abspielen · ←/→: 1 ms verschieben (⇧ 10 ms, ⌥ 0,1 ms) · Strg/⌘ + Scrollen: Zoom.
            </p>
          </div>
        </div>

        {noBeats && (
          <p className="rounded-md bg-surface-muted px-3 py-2 text-sm">
            {piece.timeline?.source !== 'notation'
              ? 'Die Taktstruktur kommt nicht aus einer Notendatei – es gibt keine Metronom-Schläge.'
              : 'Keine Schläge in der Taktstruktur – Notendatei im Setup neu einlesen.'}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={toggle}
            disabled={!buffer}
            className="flex h-10 items-center gap-2 rounded-full bg-black px-4 text-sm font-medium text-white hover:bg-black-hover disabled:opacity-40"
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
            {playing ? 'Pause' : 'Abspielen'}
          </button>
          <span ref={timeRef} className="w-24 text-sm tabular-nums text-text-secondary">
            0.000 s
          </span>
          <div className="flex items-center gap-1 text-sm" role="group" aria-label="Wiedergabetempo">
            {RATES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRate(r)}
                aria-pressed={rate === r}
                className={
                  rate === r
                    ? 'h-8 rounded-md bg-black px-2.5 font-medium text-white'
                    : 'h-8 rounded-md border border-border px-2.5 hover:bg-surface-muted'
                }
              >
                {String(r).replace('.', ',')}×
              </button>
            ))}
          </div>
          {tracks.length > 1 && (
            <select
              value={track?.id}
              onChange={(e) => setTrackId(e.target.value)}
              className="h-10 rounded-md border border-border bg-surface px-2 text-sm"
            >
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title || t.file_name}
                </option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-black"
              checked={clicksOn}
              onChange={(e) => setClicksOn(e.target.checked)}
            />
            Klicks
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-black"
              checked={quiet}
              onChange={(e) => setQuiet(e.target.checked)}
            />
            Aufnahme leiser
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-black"
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
            />
            Mitscrollen
          </label>
        </div>

        <div
          ref={scrollRef}
          className="relative overflow-x-auto rounded-md border border-border bg-surface"
          onPointerDown={(e) => {
            if (e.button !== 0 || e.target !== canvasRef.current) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            seekAt(e.clientX);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) seekAt(e.clientX);
          }}
        >
          {loadError ? (
            <p className="p-4 text-sm text-danger">Aufnahme konnte nicht geladen werden: {loadError}</p>
          ) : !buffer ? (
            <p className="p-4 text-sm text-text-secondary">Lade und dekodiere die Aufnahme …</p>
          ) : (
            <div style={{ width, height: HEIGHT }}>
              <canvas
                ref={canvasRef}
                className="sticky left-0 block cursor-text"
                style={{ width: viewWidth, height: HEIGHT }}
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Zoom</span>
          <button
            type="button"
            onClick={() => zoomTo(pxPerSec / 2)}
            aria-label="Herauszoomen"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-surface-muted"
          >
            <Minus size={14} />
          </button>
          <input
            type="range"
            min={Math.log(MIN_ZOOM)}
            max={Math.log(Math.max(MIN_ZOOM, maxZoom))}
            step={0.001}
            value={Math.log(pxPerSec)}
            onChange={(e) => zoomTo(Math.exp(Number(e.target.value)))}
            className="min-w-40 flex-1 accent-black"
          />
          <button
            type="button"
            onClick={() => zoomTo(pxPerSec * 2)}
            aria-label="Hineinzoomen"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-surface-muted"
          >
            <Plus size={14} />
          </button>
          <span className="w-28 text-right tabular-nums text-text-secondary">
            {pxPerSec >= 1000 ? `${(1000 / pxPerSec).toFixed(3)} ms/px` : `${Math.round(pxPerSec)} px/s`}
          </span>
        </div>

        <section className="space-y-3 rounded-md border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="font-medium">Verschiebung</span>
              <input
                type="text"
                inputMode="decimal"
                value={shiftDraft ?? (shift * 1000).toFixed(2)}
                onChange={(e) => setShiftDraft(e.target.value)}
                onBlur={commitDraft}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitDraft();
                  if (e.key === 'Escape') setShiftDraft(null);
                }}
                className="h-8 w-24 rounded-md border border-border bg-surface px-2 text-right text-sm tabular-nums"
              />
              <span className="text-sm text-text-secondary">ms</span>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {NUDGES.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setShift(shift + n / 1000)}
                  className="h-8 rounded-md border border-border px-2 text-xs tabular-nums hover:bg-surface-muted"
                >
                  {n > 0 ? '+' : '−'}
                  {String(Math.abs(n)).replace('.', ',')} ms
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShift(0)}
                className="h-8 rounded-md border border-border px-2 text-xs hover:bg-surface-muted"
              >
                Auf 0
              </button>
            </div>
          </div>

          <label className="block space-y-1">
            <span className="flex justify-between text-sm text-text-secondary">
              <span>Grob (±{COARSE_RANGE} s, 1-ms-Schritte)</span>
              <span className="tabular-nums">{formatMs(shift)}</span>
            </span>
            <input
              type="range"
              min={-COARSE_RANGE}
              max={COARSE_RANGE}
              step={0.001}
              value={clamp(shift, -COARSE_RANGE, COARSE_RANGE)}
              onChange={(e) => setShift(Number(e.target.value))}
              className="w-full accent-black"
            />
          </label>
          <label className="block space-y-1">
            <span className="flex justify-between text-sm text-text-secondary">
              <span>Fein (±{FINE_RANGE * 1000} ms um die aktuelle Position, 0,01-ms-Schritte)</span>
              <span className="tabular-nums">{formatMs(shift - fineCenter)}</span>
            </span>
            <input
              type="range"
              min={-FINE_RANGE}
              max={FINE_RANGE}
              step={0.00001}
              value={clamp(shift - fineCenter, -FINE_RANGE, FINE_RANGE)}
              onChange={(e) => setShift(fineCenter + Number(e.target.value), false)}
              onPointerUp={() => setFineCenter(shift)}
              onKeyUp={() => setFineCenter(shift)}
              onBlur={() => setFineCenter(shift)}
              className="w-full accent-black"
            />
          </label>

          <p className="text-sm text-text-secondary">
            Nächster Klick: <span ref={nearestRef} className="tabular-nums" />
          </p>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
            {canSave ? (
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !unsaved}
                className="flex h-10 items-center rounded-full bg-black px-4 text-sm font-medium text-white hover:bg-black-hover disabled:opacity-40"
              >
                {saving ? 'Speichert …' : 'Für die Übungsansicht speichern'}
              </button>
            ) : (
              <span className="text-sm text-text-secondary">
                Nur Verantwortliche können die Verschiebung speichern.
              </span>
            )}
            {unsaved && (
              <button
                type="button"
                onClick={() => setShift(savedShift)}
                className="h-8 rounded-md border border-border px-2 text-xs hover:bg-surface-muted"
              >
                Gespeicherten Wert wiederherstellen
              </button>
            )}
            <span className="text-sm tabular-nums text-text-secondary">
              Gespeichert: {formatMs(savedShift)}
              {unsaved ? ' · ungespeicherte Änderung' : ''}
            </span>
            {saveError && <span className="text-sm text-danger">{saveError}</span>}
          </div>
        </section>
      </div>
    </div>
  );
};
