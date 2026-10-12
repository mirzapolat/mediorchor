import type { BarSyncPoint, PieceFileKind, PieceTimeline } from '@/types';

// A bar as played on one audio track: absolute times in that recording, plus
// which occurrence of its label it is (bars inside repeats occur twice).
export interface PlayedBar {
  index: number;
  label: string;
  // The label as shown (with the piece's bar shift).
  shown: string;
  start: number;
  end: number;
  fermata: boolean;
  occurrence: number; // 1-based
  occurrences: number;
}

// Sync points that still fit these bars: past bar one, label unchanged, in
// bar order and each later than the one before (bars can't overlap).
export const validSyncPoints = (
  bars: ReadonlyArray<{ label: string }>,
  sync: readonly BarSyncPoint[] | null | undefined,
): BarSyncPoint[] => {
  const sorted = (sync ?? [])
    .filter((p) => p.bar > 0 && p.bar < bars.length && bars[p.bar].label === p.label && Number.isFinite(p.at))
    .sort((a, b) => a.bar - b.bar);
  const out: BarSyncPoint[] = [];
  let last = { bar: 0, at: 0 };
  for (const p of sorted) {
    if (p.bar === last.bar || p.at < last.at + MIN_BAR_SECONDS * (p.bar - last.bar)) continue;
    out.push(p);
    last = p;
  }
  return out;
};

// Shortest a bar may get between two sync points.
export const MIN_BAR_SECONDS = 0.05;

// Bars (times from bar one) fitted to the sync points: between two pinned
// bars the time is shared out anew — extra time goes to the bars with a
// fermata when there are any (that's where it was held), otherwise all bars
// stretch or shrink alike. After the last point bars keep their length,
// unless `endAt` pins the end of the last bar too (evenly spaced bars fill
// the recording).
export const applySync = <T extends { label: string; start: number; end: number; fermata?: boolean }>(
  bars: T[],
  sync: readonly BarSyncPoint[] | null | undefined,
  endAt?: number,
): T[] => {
  const n = bars.length;
  if (n === 0) return bars;
  const origin = bars[0].start;
  const points = validSyncPoints(bars, sync);
  const pins: Array<{ index: number; at: number }> = [
    { index: 0, at: origin },
    ...points.map((p) => ({ index: p.bar, at: origin + p.at })),
  ];
  const lastPin = pins[pins.length - 1];
  if (endAt != null && endAt > lastPin.at + MIN_BAR_SECONDS * (n - lastPin.index)) {
    pins.push({ index: n, at: endAt });
  }
  if (pins.length === 1) return bars;

  const length = bars.map((b, k) => (k + 1 < n ? bars[k + 1].start : b.end) - b.start);
  const fitted = [...length];
  for (let i = 0; i + 1 < pins.length; i++) {
    const { index: p, at: from } = pins[i];
    const { index: q, at: to } = pins[i + 1];
    const written = length.slice(p, q).reduce((sum, l) => sum + l, 0);
    const wanted = to - from;
    const held = bars.slice(p, q).filter((b) => b.fermata).length;
    for (let k = p; k < q; k++) {
      if (wanted > written && held > 0) {
        fitted[k] = length[k] + (bars[k].fermata ? (wanted - written) / held : 0);
      } else {
        fitted[k] = written > 0 ? (length[k] * wanted) / written : wanted / (q - p);
      }
    }
  }
  let t = origin;
  return bars.map((b, k) => {
    const start = t;
    t += fitted[k];
    return { ...b, start, end: t };
  });
};

// Length of the timeline in seconds once fitted to the sync points
// (notation only; even bars have none).
export const syncedDuration = (
  timeline: PieceTimeline | null,
  sync: readonly BarSyncPoint[] | null | undefined,
): number | null => {
  if (timeline?.source !== 'notation') return null;
  const fitted = applySync(timeline.bars, sync);
  return fitted[fitted.length - 1]?.end ?? 0;
};

// Maps the piece timeline onto a recording: `offset` is the lead-in before
// bar one, `duration` the recording length (needed for evenly spaced bars),
// `sync` the points the bars are fitted to.
export const resolveBars = (
  timeline: PieceTimeline | null,
  duration: number,
  offset: number,
  shift = 0,
  sync: readonly BarSyncPoint[] | null = null,
): PlayedBar[] => {
  if (!timeline) return [];
  let relative: Array<{ label: string; start: number; end: number; fermata?: boolean }>;
  if (timeline.source === 'even') {
    const count = timeline.last - timeline.first + 1;
    if (count < 1 || duration <= 0) return [];
    const span = Math.max(0, duration - offset);
    const length = span / count;
    relative = applySync(
      Array.from({ length: count }, (_, i) => ({
        label: String(timeline.first + i),
        start: i * length,
        end: (i + 1) * length,
      })),
      sync,
      span,
    );
  } else {
    relative = applySync(timeline.bars, sync);
  }
  const raw = relative.map((b) => ({
    label: b.label,
    start: offset + b.start,
    end: offset + b.end,
    fermata: Boolean(b.fermata),
  }));

  const totals = new Map<string, number>();
  for (const b of raw) totals.set(b.label, (totals.get(b.label) ?? 0) + 1);
  const seen = new Map<string, number>();
  return raw.map((b, index) => {
    const occurrence = (seen.get(b.label) ?? 0) + 1;
    seen.set(b.label, occurrence);
    return {
      ...b,
      shown: shiftBarLabel(b.label, shift),
      index,
      occurrence,
      occurrences: totals.get(b.label) ?? 1,
    };
  });
};

// Index of the bar playing at `time` (binary search), or -1 before bar one.
export const barIndexAt = (bars: PlayedBar[], time: number): number => {
  let lo = 0;
  let hi = bars.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].start <= time + 1e-3) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
};

// Bar labels in score order, each once (what markers on the PDF refer to).
export const uniqueLabels = (bars: Array<{ label: string }>): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of bars) {
    if (!seen.has(b.label)) {
      seen.add(b.label);
      out.push(b.label);
    }
  }
  return out;
};

// Written bar labels of a timeline without needing a recording.
export const timelineLabels = (timeline: PieceTimeline | null): string[] => {
  if (!timeline) return [];
  if (timeline.source === 'even') {
    return Array.from({ length: timeline.last - timeline.first + 1 }, (_, i) =>
      String(timeline.first + i),
    );
  }
  return uniqueLabels(timeline.bars);
};

// A bar label as shown: its number moved by the piece's bar shift ("12a"
// with shift 36 → "48a"). Labels without a leading number stay as they are.
export const shiftBarLabel = (label: string, shift: number): string => {
  if (!shift) return label;
  const m = /^(\d+)(.*)$/.exec(label);
  return m ? `${Number(m[1]) + shift}${m[2]}` : label;
};

// Number of the first numbered bar (before any shift), or null.
export const firstBarNumber = (labels: string[]): number | null => {
  for (const l of labels) {
    const m = /^(\d+)/.exec(l);
    if (m) return Number(m[1]);
  }
  return null;
};

// Length of the timeline in seconds (notation only; even bars have none).
export const timelineDuration = (timeline: PieceTimeline | null): number | null =>
  timeline?.source === 'notation' ? (timeline.bars[timeline.bars.length - 1]?.end ?? 0) : null;

// A piece's length: its own (set from the MusicXML or by hand), else what
// its bar timeline says.
export const pieceDuration = (piece: { duration_s: number | null; timeline: PieceTimeline | null }): number | null =>
  piece.duration_s ?? timelineDuration(piece.timeline);

// Which role an uploaded file most likely plays, from its name/type.
export const guessFileKind = (file: File): PieceFileKind => {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'score';
  if (/\.(musicxml|mxl|xml)$/.test(name)) return 'notation';
  if (/\.(mid|midi)$/.test(name)) return 'midi';
  if (file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus)$/.test(name)) {
    return 'audio';
  }
  return 'other';
};

// Lead-in silence of a recording in seconds (MuseScore exports often start
// with a short gap), measured on the decoded audio. null if it can't decode.
export const detectLeadIn = async (file: Blob): Promise<number | null> => {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(await file.arrayBuffer());
    const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
    const threshold = 0.01;
    for (let i = 0; i < audio.length; i++) {
      for (const data of channels) {
        if (Math.abs(data[i]) > threshold) return Math.round((i / audio.sampleRate) * 100) / 100;
      }
    }
    return 0;
  } catch {
    return null;
  } finally {
    void ctx.close();
  }
};

export const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};
