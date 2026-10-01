import type { PieceTimeline, TimelineBar } from '@/types';

// Reads the bar timeline out of a MusicXML file (.musicxml/.xml, or the
// zipped .mxl): how long every bar lasts given its content, meter and tempo
// marks, and the order bars are played in with repeats, voltas, D.C./D.S.,
// To Coda and Fine unfolded — the same way MuseScore plays (and exports) it.

type NotationTimeline = Extract<PieceTimeline, { source: 'notation' }>;

export class NotationError extends Error {}

// ---------------------------------------------------------------------------
// .mxl (zip) reading
// ---------------------------------------------------------------------------

const inflateRaw = async (data: Uint8Array): Promise<Uint8Array> => {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

// Minimal zip reader: walks the central directory, returns name → bytes.
const readZip = async (buf: ArrayBuffer): Promise<Map<string, () => Promise<Uint8Array>>> => {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new NotationError('zip');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map<string, () => Promise<Uint8Array>>();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new NotationError('zip');
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const dataStart =
      local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(dataStart, dataStart + size);
    entries.set(name, async () => {
      if (method === 0) return raw;
      if (method === 8) return inflateRaw(raw);
      throw new NotationError('zip');
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
};

const readXmlText = async (file: Blob): Promise<string> => {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  const isZip = head[0] === 0x50 && head[1] === 0x4b; // "PK"
  if (!isZip) return new TextDecoder().decode(buf);

  const entries = await readZip(buf);
  const decoder = new TextDecoder();
  let rootPath: string | null = null;
  const container = entries.get('META-INF/container.xml');
  if (container) {
    const doc = new DOMParser().parseFromString(decoder.decode(await container()), 'application/xml');
    rootPath = doc.querySelector('rootfile')?.getAttribute('full-path') ?? null;
  }
  rootPath ??=
    [...entries.keys()].find((k) => !k.startsWith('META-INF/') && /\.(xml|musicxml)$/i.test(k)) ??
    null;
  const entry = rootPath ? entries.get(rootPath) : undefined;
  if (!entry) throw new NotationError('zip');
  return decoder.decode(await entry());
};

// ---------------------------------------------------------------------------
// Score model
// ---------------------------------------------------------------------------

interface TempoEvent {
  pos: number; // quarter notes from the bar start
  qpm: number; // quarter notes per minute
}

interface Measure {
  label: string;
  quarters: number; // actual length in quarter notes
  tempos: TempoEvent[];
  meter: string | null; // time signature set in this bar
  beats: number; // time signature in effect (top part)
  beatType: number;
  implicit: boolean; // pickup / incomplete bar not counted in the numbering
  forward: boolean;
  backward: boolean;
  times: number; // how often a repeated section is played in total
  endings: number[] | null; // volta numbers this bar belongs to
  endingGroupMax: number; // highest volta number of its volta group
  segno: string | null;
  coda: string | null;
  toCoda: string | null;
  daCapo: boolean;
  dalSegno: string | null;
  fine: boolean;
}

const childrenNamed = (el: Element, name: string) =>
  Array.from(el.children).filter((c) => c.tagName === name);

const num = (el: Element | null | undefined): number => {
  const v = parseFloat(el?.textContent ?? '');
  return Number.isFinite(v) ? v : 0;
};

const BEAT_UNIT_QUARTERS: Record<string, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 0.25,
  '32nd': 0.125,
};

// Tempo of a <direction>: prefer <sound tempo> (always quarter notes per
// minute), fall back to a printed metronome mark.
const directionTempo = (dir: Element): number | null => {
  const sound = dir.querySelector('sound[tempo]');
  if (sound) {
    const qpm = parseFloat(sound.getAttribute('tempo') ?? '');
    if (qpm > 0) return qpm;
  }
  const metro = dir.querySelector('metronome');
  const perMinute = num(metro?.querySelector('per-minute'));
  const unit = metro?.querySelector('beat-unit')?.textContent?.trim() ?? '';
  if (metro && perMinute > 0 && BEAT_UNIT_QUARTERS[unit]) {
    const dotted = metro.querySelector('beat-unit-dot') ? 1.5 : 1;
    return perMinute * BEAT_UNIT_QUARTERS[unit] * dotted;
  }
  return null;
};

const parseEndingNumbers = (value: string): number[] =>
  value
    .split(/[,\s]+/)
    .flatMap((part) => {
      const range = part.match(/^(\d+)-(\d+)$/);
      if (range) {
        const out: number[] = [];
        for (let n = Number(range[1]); n <= Number(range[2]); n++) out.push(n);
        return out;
      }
      const n = parseInt(part, 10);
      return Number.isFinite(n) ? [n] : [];
    });

// Walks one part's bar and returns its length plus the tempo events in it.
const scanMeasure = (
  measure: Element,
  state: { divisions: number; beats: number; beatType: number },
) => {
  let pos = 0;
  let maxPos = 0;
  let meter: string | null = null;
  const tempos: TempoEvent[] = [];
  for (const el of Array.from(measure.children)) {
    switch (el.tagName) {
      case 'attributes': {
        const div = num(el.querySelector('divisions'));
        if (div > 0) state.divisions = div;
        const time = el.querySelector('time');
        if (time && !time.querySelector('senza-misura')) {
          // Composite meters ("3+2") add up.
          const beats = (time.querySelector('beats')?.textContent ?? '')
            .split('+')
            .reduce((sum, part) => sum + (parseFloat(part) || 0), 0);
          const beatType = num(time.querySelector('beat-type'));
          if (beats > 0 && beatType > 0) {
            state.beats = beats;
            state.beatType = beatType;
            meter = `${beats}/${beatType}`;
          }
        }
        break;
      }
      case 'note': {
        if (el.querySelector('grace') || el.querySelector('chord')) break;
        pos += num(el.querySelector('duration'));
        break;
      }
      case 'backup':
        pos -= num(el.querySelector('duration'));
        break;
      case 'forward':
        pos += num(el.querySelector('duration'));
        break;
      case 'direction': {
        const qpm = directionTempo(el);
        if (qpm) {
          const offset = num(childrenNamed(el, 'offset')[0]);
          tempos.push({ pos: Math.max(0, (pos + offset) / state.divisions), qpm });
        }
        break;
      }
      case 'sound': {
        const qpm = parseFloat(el.getAttribute('tempo') ?? '');
        if (qpm > 0) tempos.push({ pos: pos / state.divisions, qpm });
        break;
      }
    }
    maxPos = Math.max(maxPos, pos);
  }
  const quarters =
    maxPos > 0 ? maxPos / state.divisions : (state.beats * 4) / state.beatType;
  return { quarters, tempos, meter, beats: state.beats, beatType: state.beatType };
};

const parseScore = (xml: string): Measure[] => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new NotationError('xml');
  const root = doc.documentElement;
  if (root.tagName === 'score-timewise') throw new NotationError('timewise');
  if (root.tagName !== 'score-partwise') throw new NotationError('xml');

  const parts = childrenNamed(root, 'part').map((p) => childrenNamed(p, 'measure'));
  if (parts.length === 0 || parts[0].length === 0) throw new NotationError('empty');

  const measures: Measure[] = parts[0].map((m, i) => ({
    label: m.getAttribute('number') ?? String(i + 1),
    quarters: 0,
    tempos: [],
    meter: null,
    beats: 4,
    beatType: 4,
    implicit: m.getAttribute('implicit') === 'yes',
    forward: false,
    backward: false,
    times: 2,
    endings: null,
    endingGroupMax: 0,
    segno: null,
    coda: null,
    toCoda: null,
    daCapo: false,
    dalSegno: null,
    fine: false,
  }));

  // Length and tempo: every part is scanned (tempo marks may sit in any
  // staff); a bar lasts as long as its longest part.
  parts.forEach((partMeasures, partIndex) => {
    const state = { divisions: 1, beats: 4, beatType: 4 };
    partMeasures.forEach((m, i) => {
      const target = measures[i];
      if (!target) return;
      const scan = scanMeasure(m, state);
      target.quarters = Math.max(target.quarters, scan.quarters);
      for (const ev of scan.tempos) {
        if (!target.tempos.some((t) => Math.abs(t.pos - ev.pos) < 1e-6)) target.tempos.push(ev);
      }
      if (partIndex === 0) {
        target.meter = scan.meter;
        target.beats = scan.beats;
        target.beatType = scan.beatType;
      }
    });
  });

  // Structure (repeats, voltas, jumps) comes from the top part, as written.
  let openEnding: number[] | null = null;
  parts[0].forEach((m, i) => {
    const target = measures[i];
    for (const barline of childrenNamed(m, 'barline')) {
      const repeat = barline.querySelector('repeat');
      if (repeat?.getAttribute('direction') === 'forward') target.forward = true;
      if (repeat?.getAttribute('direction') === 'backward') {
        target.backward = true;
        const times = parseInt(repeat.getAttribute('times') ?? '', 10);
        if (times > 1) target.times = times;
      }
      const ending = barline.querySelector('ending');
      if (ending?.getAttribute('type') === 'start') {
        openEnding = parseEndingNumbers(ending.getAttribute('number') ?? '');
      }
    }
    if (openEnding) target.endings = openEnding;
    for (const barline of childrenNamed(m, 'barline')) {
      const type = barline.querySelector('ending')?.getAttribute('type');
      if (type === 'stop' || type === 'discontinue') openEnding = null;
    }
    for (const sound of Array.from(m.querySelectorAll('sound'))) {
      if (sound.hasAttribute('segno')) target.segno = sound.getAttribute('segno');
      if (sound.hasAttribute('coda')) target.coda = sound.getAttribute('coda');
      if (sound.hasAttribute('tocoda')) target.toCoda = sound.getAttribute('tocoda');
      if (sound.getAttribute('dacapo') === 'yes') target.daCapo = true;
      if (sound.hasAttribute('dalsegno')) target.dalSegno = sound.getAttribute('dalsegno');
      if (sound.hasAttribute('fine')) target.fine = true;
    }
  });

  // Adjacent volta brackets form a group; after a D.C./D.S. only the last
  // volta of each group is played.
  let groupStart = 0;
  for (let i = 0; i <= measures.length; i++) {
    const inGroup = i < measures.length && measures[i].endings;
    if (!inGroup) {
      const group = measures.slice(groupStart, i);
      const max = Math.max(0, ...group.flatMap((m) => m.endings ?? []));
      group.forEach((m) => (m.endingGroupMax = max));
      groupStart = i + 1;
    }
  }
  return measures;
};

// ---------------------------------------------------------------------------
// Timing + unfolding
// ---------------------------------------------------------------------------

const DEFAULT_QPM = 120; // MuseScore's default when a score has no tempo mark

// Length of one metronome beat in quarter notes: the meter's denominator,
// or a dotted beat in compound meters (6/8, 9/8, 12/16 …) — as MuseScore
// counts them.
const beatQuarters = (beats: number, beatType: number) =>
  beatType >= 8 && beats > 3 && beats % 3 === 0 ? (3 * 4) / beatType : 4 / beatType;

interface MeasureTiming {
  seconds: number;
  beats: number[]; // seconds from the bar start
  downbeat: boolean;
}

// Timing per written bar, carrying the tempo along in written order (the
// tempo map follows the score, not the playback order): its length and
// where its metronome beats fall.
const measureTiming = (measures: Measure[]): MeasureTiming[] => {
  let qpm = DEFAULT_QPM;
  return measures.map((m, index) => {
    const events = [...m.tempos].sort((a, b) => a.pos - b.pos);
    // Tempo segments of the bar: from `pos` on, `qpm` applies.
    const segments: Array<{ pos: number; at: number; qpm: number }> = [];
    let seconds = 0;
    let pos = 0;
    for (const ev of events) {
      const until = Math.min(ev.pos, m.quarters);
      segments.push({ pos, at: seconds, qpm });
      seconds += ((until - pos) * 60) / qpm;
      pos = Math.max(pos, until);
      qpm = ev.qpm;
    }
    segments.push({ pos, at: seconds, qpm });
    seconds += ((m.quarters - pos) * 60) / qpm;

    const timeAt = (q: number) => {
      let seg = segments[0];
      for (const s of segments) if (s.pos <= q + 1e-9) seg = s;
      return seg.at + ((q - seg.pos) * 60) / seg.qpm;
    };

    // A pickup bar is the end of a full bar: its beats line up from the end.
    const nominal = (m.beats * 4) / m.beatType;
    const pickup = (m.implicit || index === 0) && m.quarters < nominal - 1e-6;
    const shift = pickup ? nominal - m.quarters : 0;
    const unit = beatQuarters(m.beats, m.beatType);
    const beats: number[] = [];
    for (let k = Math.ceil(shift / unit - 1e-6); k * unit - shift < m.quarters - 1e-6; k++) {
      beats.push(round(timeAt(k * unit - shift)));
    }
    return { seconds, beats, downbeat: shift < 1e-6 };
  });
};

const MAX_PLAYED_BARS = 20000;

// Written bar indices in playback order.
const unfold = (measures: Measure[]): number[] => {
  const order: number[] = [];
  const findLabel = (key: 'segno' | 'coda', value: string | null) => {
    const exact = measures.findIndex((m) => m[key] != null && m[key] === value);
    return exact >= 0 ? exact : measures.findIndex((m) => m[key] != null);
  };

  let i = 0;
  let repeatStart = 0;
  let pass = 1;
  let jumped = false;
  let cameBack = false;
  let lastHadEnding = false;
  const repeatCounts = new Map<number, number>();
  const jumpsDone = new Set<number>();

  while (i < measures.length && order.length < MAX_PLAYED_BARS) {
    const m = measures[i];
    if (m.forward && !cameBack) {
      repeatStart = i;
      pass = 1;
    }
    cameBack = false;

    if (m.endings) {
      const wanted = jumped ? m.endingGroupMax : pass;
      if (!m.endings.includes(wanted)) {
        i++;
        continue;
      }
    } else if (lastHadEnding) {
      pass = 1;
    }
    lastHadEnding = Boolean(m.endings);

    order.push(i);

    if (jumped && m.fine) break;
    if (jumped && m.toCoda != null) {
      const coda = findLabel('coda', m.toCoda);
      if (coda >= 0) {
        i = coda;
        cameBack = true;
        lastHadEnding = false;
        continue;
      }
    }
    // Repeats are not taken again after a D.C./D.S. (MuseScore's default).
    if (m.backward && !jumped) {
      const done = repeatCounts.get(i) ?? 1;
      if (done < m.times) {
        repeatCounts.set(i, done + 1);
        pass = done + 1;
        i = repeatStart;
        cameBack = true;
        lastHadEnding = false;
        continue;
      }
      repeatCounts.delete(i);
      repeatStart = i + 1;
    } else if (m.endings) {
      repeatStart = i + 1;
    }
    if (!jumpsDone.has(i) && (m.daCapo || m.dalSegno != null)) {
      jumpsDone.add(i);
      jumped = true;
      pass = 1;
      const target = m.daCapo ? 0 : Math.max(0, findLabel('segno', m.dalSegno));
      i = target;
      repeatStart = target;
      cameBack = true;
      lastHadEnding = false;
      continue;
    }
    i++;
  }
  return order;
};

export const parseNotation = async (file: Blob): Promise<NotationTimeline> => {
  const measures = parseScore(await readXmlText(file));
  const timing = measureTiming(measures);
  const bars: TimelineBar[] = [];
  let t = 0;
  for (const index of unfold(measures)) {
    const { seconds, beats, downbeat } = timing[index];
    const end = t + seconds;
    bars.push({ label: measures[index].label, start: round(t), end: round(end), beats, downbeat });
    t = end;
  }
  if (bars.length === 0) throw new NotationError('empty');

  const meters = measures.map((m) => m.meter).filter((m): m is string => !!m);
  const tempoMarks = measures.flatMap((m) => m.tempos);
  return {
    source: 'notation',
    bars,
    written: measures.length,
    tempoChanges: Math.max(0, tempoMarks.length - 1),
    meterChanges: Math.max(0, meters.length - 1),
    repeats: measures.filter((m) => m.backward || m.daCapo || m.dalSegno != null).length,
  };
};

const round = (s: number) => Math.round(s * 1000) / 1000;

export const isNotationFileName = (name: string) => /\.(musicxml|mxl|xml)$/i.test(name);
