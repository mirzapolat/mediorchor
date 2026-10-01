import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { pieceFileUrl } from '@/lib/pieceFiles';
import { resolveBars, formatTime } from '@/lib/pieceTimeline';
import { clicksFromBars, createAudioContext, runMetronome, type Click } from '@/lib/metronome';
import { estimateBeatShift } from '@/lib/beatAlignment';
import type { Piece, PieceFile } from '@/types';

// Debug view for the metronome (piece URL + `?metronome-debug`): the
// recording's waveform with every click drawn where it is scheduled, plus
// sliders to stretch and shift the clicks to see where they go wrong.
// Read-only: nothing here is saved.

const WAVE_HEIGHT = 180;
const MAX_CANVAS_PX = 32000;

// Theme token (e.g. --c-text = "26 26 26") as a canvas colour.
const token = (name: string, alpha = 1) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '0 0 0';
  return `rgb(${v} / ${alpha})`;
};

const Slider = ({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  reset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
  reset: number;
}) => (
  <label className="block space-y-1">
    <span className="flex items-center justify-between text-sm">
      <span className="font-medium">{label}</span>
      <span className="flex items-center gap-2 tabular-nums text-text-secondary">
        {display}
        <button
          type="button"
          onClick={() => onChange(reset)}
          className="rounded border border-border px-1.5 text-xs hover:bg-surface-muted"
        >
          Reset
        </button>
      </span>
    </span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full accent-black"
    />
  </label>
);

export const MetronomeDebug = ({ piece, tracks }: { piece: Piece; tracks: PieceFile[] }) => {
  const [trackId, setTrackId] = useState(tracks[0]?.id ?? '');
  const track = tracks.find((t) => t.id === trackId) ?? tracks[0] ?? null;
  const offset = track?.offset_s ?? 0;

  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [shift, setShift] = useState(0);
  const [zoom, setZoom] = useState(80); // px per second
  const [clicksOn, setClicksOn] = useState(true);
  const [quiet, setQuiet] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [latency, setLatency] = useState<{ measured: number | null; output: number; base: number } | null>(
    null,
  );

  const ctxRef = useRef<AudioContext | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const marksRef = useRef<HTMLCanvasElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);

  const getCtx = () => (ctxRef.current ??= createAudioContext());

  // Recording: an <audio> element for playback, decoded samples for the waveform.
  useEffect(() => {
    if (!track?.file_path) return;
    const url = pieceFileUrl(track.file_path);
    const audio = new Audio(url);
    audio.preload = 'auto';
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
    };
  }, [track?.file_path]);

  useEffect(() => () => void ctxRef.current?.close(), []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = quiet ? 0.25 : 1;
  }, [quiet, track?.file_path]);

  const duration = buffer?.duration ?? 0;
  const bars = useMemo(() => resolveBars(piece.timeline, duration, offset, piece.bar_shift), [piece.timeline, duration, offset, piece.bar_shift]);

  // The clicks as the player computes them, then stretched around bar one
  // (speed) and moved (shift) by the sliders.
  const clicks: Click[] = useMemo(
    () =>
      clicksFromBars(bars).map((c) => ({
        ...c,
        time: offset + (c.time - offset) / speed + shift,
      })),
    [bars, offset, speed, shift],
  );

  // Where the recording's note onsets say the beats belong (from the
  // unshifted clicks, so it is the correction the clicks need).
  const measured = useMemo(
    () => (buffer ? estimateBeatShift(buffer, clicksFromBars(bars).map((c) => c.time), 1) : null),
    [buffer, bars],
  );

  const pxPerSec = duration > 0 ? Math.min(zoom, MAX_CANVAS_PX / duration) : zoom;
  const width = Math.max(1, Math.ceil(duration * pxPerSec));

  // Waveform: min/max per pixel column.
  useEffect(() => {
    const canvas = waveRef.current;
    if (!canvas || !buffer) return;
    canvas.width = width;
    canvas.height = WAVE_HEIGHT;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, width, WAVE_HEIGHT);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    const perPx = buffer.sampleRate / pxPerSec;
    const mid = WAVE_HEIGHT / 2;
    g.fillStyle = token('--c-text-secondary', 0.75);
    for (let x = 0; x < width; x++) {
      const from = Math.floor(x * perPx);
      const to = Math.min(buffer.length, Math.floor((x + 1) * perPx));
      let lo = 0;
      let hi = 0;
      for (let i = from; i < to; i++) {
        for (const data of channels) {
          const v = data[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      g.fillRect(x, mid - hi * mid, 1, Math.max(1, (hi - lo) * mid));
    }
    g.fillStyle = token('--c-border-strong');
    g.fillRect(0, mid, width, 1);
  }, [buffer, width, pxPerSec]);

  // Click marks: downbeats strong, other beats thin; bar numbers on top;
  // the track's lead-in as a dashed line.
  useEffect(() => {
    const canvas = marksRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = WAVE_HEIGHT;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, width, WAVE_HEIGHT);
    for (const c of clicks) {
      const x = Math.round(c.time * pxPerSec);
      g.fillStyle = c.accent ? token('--c-danger') : token('--c-chart-1', 0.8);
      g.fillRect(x, 0, c.accent ? 2 : 1, WAVE_HEIGHT);
    }
    g.font = '11px system-ui, sans-serif';
    g.fillStyle = token('--c-danger');
    for (const b of bars) {
      const start = offset + (b.start - offset) / speed + shift;
      g.fillText(b.shown, Math.round(start * pxPerSec) + 3, 12);
    }
    g.strokeStyle = token('--c-success');
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(Math.round(offset * pxPerSec) + 0.5, 0);
    g.lineTo(Math.round(offset * pxPerSec) + 0.5, WAVE_HEIGHT);
    g.stroke();
  }, [clicks, bars, width, pxPerSec, offset, speed, shift, buffer]);

  // Clicks follow playback through the same scheduler as the player.
  useEffect(() => {
    const audio = audioRef.current;
    const ctx = ctxRef.current;
    if (!playing || !clicksOn || !audio || !ctx) return;
    void ctx.resume();
    return runMetronome(ctx, audio, clicks, () => null);
  }, [playing, clicksOn, clicks]);

  // Playhead + latency readout.
  useEffect(() => {
    let raf = 0;
    let lastLatency = 0;
    const tick = (now: number) => {
      const audio = audioRef.current;
      if (audio && headRef.current) {
        const x = audio.currentTime * pxPerSec;
        headRef.current.style.transform = `translateX(${x}px)`;
        if (timeRef.current) timeRef.current.textContent = `${audio.currentTime.toFixed(3)} s`;
        const scroller = scrollRef.current;
        if (scroller && !audio.paused) {
          if (x < scroller.scrollLeft || x > scroller.scrollLeft + scroller.clientWidth - 40) {
            scroller.scrollLeft = x - 80;
          }
        }
      }
      const ctx = ctxRef.current;
      if (ctx && now - lastLatency > 500) {
        lastLatency = now;
        let measured: number | null = null;
        const ts = ctx.getOutputTimestamp?.();
        if (ts && ts.contextTime && ts.performanceTime) {
          measured = ctx.currentTime - (ts.contextTime + (performance.now() - ts.performanceTime) / 1000);
        }
        setLatency({ measured, output: ctx.outputLatency || 0, base: ctx.baseLatency || 0 });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pxPerSec]);

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

  // Space plays/pauses here (and not the regular player behind this view).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || (e.target as HTMLElement)?.closest('input, select, textarea')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      toggle();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [toggle]);

  const seekAt = (clientX: number) => {
    const audio = audioRef.current;
    const scroller = scrollRef.current;
    if (!audio || !scroller) return;
    const rect = scroller.getBoundingClientRect();
    audio.currentTime = Math.max(0, (clientX - rect.left + scroller.scrollLeft) / pxPerSec);
  };

  const timeline = piece.timeline;
  const firstClick = clicks[0]?.time;
  const ms = (s: number) => `${(s * 1000).toFixed(1)} ms`;

  return (
    <div className="space-y-4 pb-10">
      <div>
        <h1 className="text-xl font-bold">Metronom-Debug · {piece.name}</h1>
        <p className="text-sm text-text-secondary">
          Nur zum Untersuchen – hier wird nichts gespeichert. Rot: Taktanfänge (betonte Klicks), blau: übrige
          Schläge, grün gestrichelt: Vorlauf der Tonspur. Klick in die Wellenform springt dorthin, Leertaste
          spielt/pausiert.
        </p>
      </div>

      {timeline?.source !== 'notation' ? (
        <p className="rounded-md bg-surface-muted px-3 py-2 text-sm">
          Die Taktstruktur kommt nicht aus einer Notendatei – es gibt keine Metronom-Schläge.
        </p>
      ) : buffer && clicks.length === 0 ? (
        <p className="rounded-md bg-surface-muted px-3 py-2 text-sm">
          Keine Schläge in der Taktstruktur – Notendatei im Setup neu einlesen.
        </p>
      ) : null}

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
      </div>

      <div
        ref={scrollRef}
        className="relative overflow-x-auto rounded-md border border-border bg-surface"
        onPointerDown={(e) => seekAt(e.clientX)}
      >
        {loadError ? (
          <p className="p-4 text-sm text-danger">Aufnahme konnte nicht geladen werden: {loadError}</p>
        ) : !buffer ? (
          <p className="p-4 text-sm text-text-secondary">Lade und dekodiere die Aufnahme …</p>
        ) : (
          <div className="relative cursor-text" style={{ width, height: WAVE_HEIGHT }}>
            <canvas ref={waveRef} className="absolute inset-0" style={{ width, height: WAVE_HEIGHT }} />
            <canvas ref={marksRef} className="absolute inset-0" style={{ width, height: WAVE_HEIGHT }} />
            <div ref={headRef} className="pointer-events-none absolute inset-y-0 left-0 w-px bg-black" />
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Slider
          label="Metronom-Geschwindigkeit"
          value={speed}
          min={0.9}
          max={1.1}
          step={0.0005}
          reset={1}
          display={`${(speed * 100).toFixed(2)} %`}
          onChange={setSpeed}
        />
        <Slider
          label="Verschiebung"
          value={shift}
          min={-0.5}
          max={0.5}
          step={0.001}
          reset={0}
          display={`${shift >= 0 ? '+' : ''}${(shift * 1000).toFixed(0)} ms`}
          onChange={setShift}
        />
        <Slider
          label="Zoom"
          value={zoom}
          min={20}
          max={600}
          step={10}
          reset={80}
          display={`${Math.round(pxPerSec)} px/s`}
          onChange={setZoom}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm">
        <span>
          <span className="font-medium">Aus der Aufnahme gemessen:</span>{' '}
          {measured ? (
            <span className="tabular-nums">
              Klicks gehören {measured.shift >= 0 ? '+' : ''}
              {(measured.shift * 1000).toFixed(0)} ms verschoben (Eindeutigkeit {measured.confidence.toFixed(1)}×)
            </span>
          ) : buffer ? (
            'zu wenige Schläge'
          ) : (
            '–'
          )}
        </span>
        {measured && (
          <button
            type="button"
            onClick={() => {
              setSpeed(1);
              setShift(measured.shift);
            }}
            className="rounded border border-border bg-surface px-2 py-0.5 text-xs hover:bg-surface-hover"
          >
            Übernehmen
          </button>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm tabular-nums sm:grid-cols-4">
        <dt className="text-text-secondary">Aufnahme</dt>
        <dd>{buffer ? `${formatTime(duration)} (${duration.toFixed(3)} s)` : '–'}</dd>
        <dt className="text-text-secondary">Vorlauf (Setup)</dt>
        <dd>{offset.toFixed(3)} s</dd>
        <dt className="text-text-secondary">Erster Klick</dt>
        <dd>{firstClick != null ? `${firstClick.toFixed(3)} s` : '–'}</dd>
        <dt className="text-text-secondary">Ende Taktstruktur</dt>
        <dd>
          {bars.length > 0
            ? `${(offset + (bars[bars.length - 1].end - offset) / speed + shift).toFixed(3)} s`
            : '–'}
        </dd>
        <dt className="text-text-secondary">Takte gespielt</dt>
        <dd>{bars.length}</dd>
        <dt className="text-text-secondary">Klicks</dt>
        <dd>{clicks.length}</dd>
        <dt className="text-text-secondary">Latenz gemessen</dt>
        <dd>{latency?.measured != null ? ms(latency.measured) : '–'}</dd>
        <dt className="text-text-secondary">output / base</dt>
        <dd>{latency ? `${ms(latency.output)} / ${ms(latency.base)}` : '–'}</dd>
      </dl>
    </div>
  );
};
