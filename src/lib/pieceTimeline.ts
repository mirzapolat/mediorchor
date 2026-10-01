import type { PieceFileKind, PieceTimeline } from '@/types';

// A bar as played on one audio track: absolute times in that recording, plus
// which occurrence of its label it is (bars inside repeats occur twice).
export interface PlayedBar {
  index: number;
  label: string;
  // The label as shown (with the piece's bar shift).
  shown: string;
  start: number;
  end: number;
  occurrence: number; // 1-based
  occurrences: number;
  // Metronome beats in recording time (notation timelines only).
  beats: number[];
  downbeat: boolean;
}

// Maps the piece timeline onto a recording: `offset` is the lead-in before
// bar one, `duration` the recording length (needed for evenly spaced bars).
export const resolveBars = (
  timeline: PieceTimeline | null,
  duration: number,
  offset: number,
  shift = 0,
): PlayedBar[] => {
  if (!timeline) return [];
  let raw: Array<{ label: string; start: number; end: number; beats: number[]; downbeat: boolean }>;
  if (timeline.source === 'even') {
    const count = timeline.last - timeline.first + 1;
    if (count < 1 || duration <= 0) return [];
    const length = Math.max(0, duration - offset) / count;
    raw = Array.from({ length: count }, (_, i) => ({
      label: String(timeline.first + i),
      start: offset + i * length,
      end: offset + (i + 1) * length,
      beats: [],
      downbeat: false,
    }));
  } else {
    raw = timeline.bars.map((b) => ({
      label: b.label,
      start: offset + b.start,
      end: offset + b.end,
      beats: (b.beats ?? []).map((s) => offset + b.start + s),
      downbeat: b.downbeat ?? false,
    }));
  }

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

const VOICES: Array<[RegExp, string]> = [
  [/\b(?:sopran|soprano|sop)\s*(\d)?\b/i, 'Sopran'],
  [/\bmezzo\s*(\d)?\b/i, 'Mezzo'],
  [/\b(?:alt|alto)\s*(\d)?\b/i, 'Alt'],
  [/\b(?:tenor|ten)\s*(\d)?\b/i, 'Tenor'],
  [/\b(?:bariton|baritone)\s*(\d)?\b/i, 'Bariton'],
  [/\b(?:bass|basso)\s*(\d)?\b/i, 'Bass'],
  [/\b(?:tutti|alle|full|gesamt|chor|choir)\b/i, 'Tutti'],
  [/\b(?:klavier|piano|begleitung|accompaniment)\b/i, 'Klavier'],
];

// Suggests a track name from the file name: "Ave-verum_Sopran.mp3" → Sopran,
// "…_Tenor_2.mp3" → Tenor 2; falls back to the bare file name.
export const guessVoice = (fileName: string): string => {
  const base = fileName.replace(/\.[^.]+$/, '');
  const words = base.replace(/[_\-.()[\]]+/g, ' ');
  for (const [re, voice] of VOICES) {
    const match = words.match(re);
    if (match) return match[1] ? `${voice} ${match[1]}` : voice;
  }
  return base;
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
