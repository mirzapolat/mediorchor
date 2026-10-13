import type { BarAnchor, PieceTimeline, TimelineBar } from '@/types';

// Reads MuseScore's bar positions export (.mpos: `mscore -o piece.mpos
// piece.mscz`): <elements> lists the score's bars in order (id 0, 1, …, with
// their place on the page), <events> every bar as it is played — repeats
// unfolded — with its start in milliseconds, exactly as MuseScore plays it
// (tempo changes, fermatas, ritardandi included).

type MscoreTimeline = Extract<PieceTimeline, { source: 'mscore' }>;

export class TimingError extends Error {}

export const isTimingFileName = (name: string) => /\.mpos$/i.test(name);

// A MuseScore score itself (offered for download with the sheet music).
export const isMuseScoreFileName = (name: string) => /\.msc[zx]$/i.test(name);

const round = (s: number) => Math.round(s * 1000) / 1000;

// The bars are counted 1, 2, … by their written bar (a repeated bar keeps
// its number); the bar editor's numbering shifts them (pickup bars).
export const parseMpos = (text: string): MscoreTimeline => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.tagName !== 'score') throw new TimingError('xml');
  const elements = Array.from(doc.querySelectorAll('elements > element'));
  const events = Array.from(doc.querySelectorAll('events > event'))
    .map((e) => ({ bar: Number(e.getAttribute('elid')), ms: Number(e.getAttribute('position')) }))
    .filter((e) => Number.isInteger(e.bar) && e.bar >= 0 && Number.isFinite(e.ms));
  if (events.length === 0) throw new TimingError('empty');
  const count = Math.max(elements.length, ...events.map((e) => e.bar + 1));
  const bars: TimelineBar[] = events.map((e, i) => {
    const start = e.ms / 1000;
    // The export has no end for the last bar: the length of the bar before it.
    const end = i + 1 < events.length ? events[i + 1].ms / 1000 : start + (i > 0 ? start - events[i - 1].ms / 1000 : 2);
    return { label: String(e.bar + 1), start: round(start), end: round(Math.max(end, start)) };
  });
  // Bar one at 0 (the recording's lead-in is per voice).
  const origin = bars[0].start;
  for (const b of bars) {
    b.start = round(b.start - origin);
    b.end = round(b.end - origin);
  }

  return {
    source: 'mscore',
    bars,
    written: count,
    repeats: events.filter((e, i) => i > 0 && e.bar <= events[i - 1].bar).length,
    labels: 'counted',
  };
};

export const readMpos = async (file: Blob) => parseMpos(await file.text());

// PNG resolutions MuseScore may be set to export with; the .mpos uses that
// resolution × 12 per inch (1200 dpi by default: 200 units per point).
const EXPORT_DPIS = [72, 96, 100, 120, 150, 200, 300, 400, 600, 1200, 2400];
// MuseScore's frame ends at the staff lines; a little room above and below
// takes in notes and text off the staff and is easier to tap (page height).
const FRAME_PAD = 0.012;

// Each bar's frame on the score PDF — when that PDF was exported from the
// same MuseScore file, the <elements> are where its bars sit (a frame
// around the whole system's bar). `pages` are the PDF's page sizes in
// points. The scale is taken from the page: MuseScore's left and right
// margins are alike, so the widest bars span the page width less both
// margins; snapped to a resolution MuseScore exports with. Throws when the
// frames don't fit the PDF (most likely another PDF).
export const mposBarFrames = (
  text: string,
  pages: Array<{ width: number; height: number }>,
): Record<string, BarAnchor> => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.tagName !== 'score') throw new TimingError('xml');
  const elements = Array.from(doc.querySelectorAll('elements > element'))
    .map((e) => {
      const n = (name: string) => Number(e.getAttribute(name));
      return { id: n('id'), x: n('x'), y: n('y'), w: n('sx'), h: n('sy'), page: n('page') };
    })
    .filter((e) => [e.id, e.x, e.y, e.w, e.h, e.page].every(Number.isFinite));
  if (elements.length === 0 || pages.length === 0) throw new TimingError('empty');

  const left = Math.min(...elements.map((e) => e.x));
  const right = Math.max(...elements.map((e) => e.x + e.w));
  const estimate = (left + right) / pages[0].width;
  const snapped = EXPORT_DPIS.map((dpi) => (dpi / 72) * 12).find((u) => Math.abs(u - estimate) / u < 0.06);
  const perPoint = snapped ?? estimate;

  const anchors: Record<string, BarAnchor> = {};
  for (const e of elements) {
    const page = pages[e.page];
    if (!page) throw new TimingError('pages');
    const frame = {
      page: e.page + 1,
      x: e.x / perPoint / page.width,
      y: e.y / perPoint / page.height,
      w: e.w / perPoint / page.width,
      h: e.h / perPoint / page.height,
    };
    if (frame.x < -0.02 || frame.y < -0.02 || frame.x + frame.w > 1.02 || frame.y + frame.h > 1.02) {
      throw new TimingError('fit');
    }
    const round = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;
    const top = Math.max(0, frame.y - FRAME_PAD);
    const bottom = Math.min(1, frame.y + frame.h + FRAME_PAD);
    const label = String(e.id + 1);
    anchors[label] ??= { page: frame.page, x: round(frame.x), y: round(top), w: round(frame.w), h: round(bottom - top) };
  }
  return anchors;
};
