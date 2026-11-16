// The practice mixer, running on the audio thread (AudioWorklet).
//
// Every voice's recording is decoded completely up front and handed over
// here; one playhead reads all of them. So voices can never drift apart,
// a slow network can't make one stall, and a recording that ends early just
// falls silent while the others play on — the piece always runs to the end
// of its longest recording.
//
// At other speeds than 1× the mix goes through a WSOLA time stretcher
// (overlapping windowed frames, each placed where it best continues the
// last one), which keeps the pitch.
//
// Messages in (see engine.ts): source, dropSource, voice, dropVoice, end,
// play, pause, seek, rate, loop. Out: state (position report), ended, looped.

declare const sampleRate: number;
declare const currentFrame: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const SCALE = 1 / 32768;

interface Source {
  channels: Int16Array[];
  length: number;
}

interface Voice {
  source: string | null;
  // Frames the recording starts after the piece's time zero.
  shift: number;
  gain: number; // current (smoothed)
  target: number;
}

type Message =
  | { type: 'source'; key: string; channels: Int16Array[] }
  | { type: 'dropSource'; key: string }
  | { type: 'voice'; id: string; source: string | null; shift: number; gain: number }
  | { type: 'dropVoice'; id: string }
  | { type: 'end'; frames: number }
  | { type: 'play'; pos?: number }
  | { type: 'pause' }
  | { type: 'seek'; pos: number }
  | { type: 'rate'; value: number }
  | { type: 'loop'; from: number | null; to: number | null };

// Fades on start, stop and jumps, so nothing clicks.
const FADE = Math.round(sampleRate * 0.006);
// Gains move at most this much per 128-frame block (≈ 40 ms from 0 to 1).
const GAIN_STEP = 128 / (sampleRate * 0.04);

// WSOLA frame (≈ 43 ms), hop and search range.
const N = sampleRate > 70000 ? 4096 : 2048;
const H = N / 2;
const SEARCH = N / 4;
const WINDOW = (() => {
  const w = new Float32Array(N);
  // Periodic Hann: at 50 % overlap the windows add up to exactly 1.
  for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  return w;
})();

class PracticeMixer extends AudioWorkletProcessor {
  private sources = new Map<string, Source>();
  private voices = new Map<string, Voice>();
  private endFrames = 0;
  private playing = false;
  private pos = 0; // the frame being heard now (fractional while stretching)
  private rate = 1;
  private loop: { from: number; to: number } | null = null;
  private master = 1;
  // Fade envelope: `env` moves to `envTarget`; a jump or stop waits for 0.
  private env = 0;
  private envTarget = 0;
  private pendingJump: number | null = null;
  private stopAfterFade = false;
  private lastReport = 0;

  // Stretcher state.
  private stretching = false;
  private nominal = 0; // ideal start of the next analysis frame
  private prevStart = 0; // where the last frame was actually taken from
  private first = true;
  private olaL = new Float32Array(N);
  private olaR = new Float32Array(N);
  private fifoL = new Float32Array(N * 4);
  private fifoR = new Float32Array(N * 4);
  private fifoLen = 0;
  private frameL = new Float32Array(N);
  private frameR = new Float32Array(N);
  private monoRegion = new Float32Array(2 * SEARCH + H + 8);
  private monoNatural = new Float32Array(H);
  private scratchR = new Float32Array(Math.max(N, 2 * SEARCH + H + 8));

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<Message>) => this.onMessage(e.data);
  }

  private onMessage(m: Message) {
    switch (m.type) {
      case 'source':
        this.sources.set(m.key, { channels: m.channels, length: m.channels[0]?.length ?? 0 });
        break;
      case 'dropSource':
        this.sources.delete(m.key);
        break;
      case 'voice': {
        const v = this.voices.get(m.id);
        if (v) {
          v.source = m.source;
          v.shift = m.shift;
          v.target = m.gain;
        } else {
          // A voice joining while playing fades in; while paused it starts
          // at its level.
          this.voices.set(m.id, { source: m.source, shift: m.shift, gain: this.playing ? 0 : m.gain, target: m.gain });
        }
        this.updateMaster();
        break;
      }
      case 'dropVoice':
        this.voices.delete(m.id);
        this.updateMaster();
        break;
      case 'end':
        this.endFrames = m.frames;
        break;
      case 'play':
        if (m.pos != null) this.pos = this.clampPos(m.pos);
        if (this.pos >= this.endFrames - 1) this.pos = this.loop ? this.loop.from : 0;
        if (!this.playing || this.stopAfterFade) {
          if (!this.playing) {
            this.env = 0;
            this.resetStretch();
          }
          this.playing = true;
          this.stopAfterFade = false;
          if (this.pendingJump == null) this.envTarget = 1;
        }
        this.report(true);
        break;
      case 'pause':
        if (this.playing) {
          this.stopAfterFade = true;
          this.envTarget = 0;
        }
        this.report(true);
        break;
      case 'seek':
        this.jump(this.clampPos(m.pos));
        this.report(true);
        break;
      case 'rate':
        if (m.value !== this.rate) {
          this.rate = m.value;
          this.resetStretch();
        }
        this.report(true);
        break;
      case 'loop':
        this.loop = m.from == null || m.to == null ? null : { from: m.from, to: m.to };
        break;
    }
  }

  private clampPos(p: number) {
    return Math.max(0, Math.min(p, Math.max(0, this.endFrames - 1)));
  }

  // Voices add up; keep the sum from clipping (uncorrelated voices add
  // like their power), the limiter after us catches the rest.
  private updateMaster() {
    let power = 0;
    for (const v of this.voices.values()) if (v.source) power += v.target * v.target;
    this.master = 1 / Math.max(1, Math.sqrt(power));
  }

  private jump(to: number) {
    if (!this.playing || this.stopAfterFade) {
      this.pos = to;
      this.pendingJump = null;
      this.resetStretch();
      return;
    }
    this.pendingJump = to;
    this.envTarget = 0;
  }

  private resetStretch() {
    this.stretching = this.rate !== 1;
    this.nominal = this.pos;
    this.prevStart = Math.round(this.pos);
    this.first = true;
    this.olaL.fill(0);
    this.olaR.fill(0);
    this.fifoLen = 0;
  }

  private report(force = false) {
    if (!force && currentFrame - this.lastReport < sampleRate * 0.25) return;
    this.lastReport = currentFrame;
    this.port.postMessage({
      type: 'state',
      pos: this.pos,
      frame: currentFrame,
      playing: this.playing && !this.stopAfterFade,
      rate: this.rate,
    });
  }

  // Adds the voices' samples from piece frame `start` on into `l`/`r` at
  // `at`; with `ramp` each voice's gain glides to its next step meanwhile.
  private mix(start: number, len: number, l: Float32Array, r: Float32Array, at: number, ramp: boolean) {
    for (const v of this.voices.values()) {
      const src = v.source ? this.sources.get(v.source) : undefined;
      if (!src) continue;
      const g0 = v.gain * this.master;
      const g1 = ramp ? this.nextGain(v) * this.master : g0;
      if (g0 === 0 && g1 === 0) continue;
      const dg = (g1 - g0) / len;
      const from = start - v.shift;
      // Only the part that overlaps the recording.
      const i0 = Math.max(0, -from);
      const i1 = Math.min(len, src.length - from);
      if (i1 <= i0) continue;
      const a = src.channels[0];
      const b = src.channels[1] ?? a;
      let g = g0 + dg * i0;
      for (let i = i0; i < i1; i++, g += dg) {
        l[at + i] += a[from + i] * SCALE * g;
        r[at + i] += b[from + i] * SCALE * g;
      }
    }
  }

  private nextGain(v: Voice) {
    const d = v.target - v.gain;
    return Math.abs(d) <= GAIN_STEP ? v.target : v.gain + Math.sign(d) * GAIN_STEP;
  }

  private stepGains() {
    for (const v of this.voices.values()) v.gain = this.nextGain(v);
  }

  // Mono samples of the mix (for the stretcher's similarity search).
  private mixMono(start: number, len: number, out: Float32Array) {
    out.fill(0, 0, len);
    this.scratchR.fill(0, 0, len);
    this.mix(start, len, out, this.scratchR, 0, false);
    for (let i = 0; i < len; i++) out[i] += this.scratchR[i];
  }

  // One WSOLA hop: H more frames into the FIFO.
  private stretchHop() {
    let start = Math.round(this.nominal);
    if (!this.first) {
      // The natural continuation of the last frame, and the region around
      // the ideal position to search for the start that fits it best.
      const natural = this.prevStart + H;
      this.mixMono(natural, H, this.monoNatural);
      let energyN = 0;
      for (let i = 0; i < H; i += 4) energyN += this.monoNatural[i] * this.monoNatural[i];
      if (energyN > 1e-6) {
        const base = start - SEARCH;
        this.mixMono(base, 2 * SEARCH + H, this.monoRegion);
        const score = (off: number, step: number) => {
          let dot = 0;
          let energy = 0;
          for (let i = 0; i < H; i += step) {
            const c = this.monoRegion[off + i];
            dot += c * this.monoNatural[i];
            energy += c * c;
          }
          return energy > 0 ? dot / Math.sqrt(energy) : -Infinity;
        };
        let best = SEARCH;
        let bestScore = -Infinity;
        for (let off = 0; off <= 2 * SEARCH; off += 2) {
          const s = score(off, 4);
          if (s > bestScore) {
            bestScore = s;
            best = off;
          }
        }
        let fine = best;
        let fineScore = -Infinity;
        for (let off = Math.max(0, best - 2); off <= Math.min(2 * SEARCH, best + 2); off++) {
          const s = score(off, 2);
          if (s > fineScore) {
            fineScore = s;
            fine = off;
          }
        }
        start = base + fine;
      }
    }
    this.first = false;

    this.frameL.fill(0);
    this.frameR.fill(0);
    this.mix(start, N, this.frameL, this.frameR, 0, false);
    for (let i = 0; i < N; i++) {
      this.olaL[i] += this.frameL[i] * WINDOW[i];
      this.olaR[i] += this.frameR[i] * WINDOW[i];
    }
    // The first half is complete now.
    this.fifoL.set(this.olaL.subarray(0, H), this.fifoLen);
    this.fifoR.set(this.olaR.subarray(0, H), this.fifoLen);
    this.fifoLen += H;
    this.olaL.copyWithin(0, H);
    this.olaR.copyWithin(0, H);
    this.olaL.fill(0, N - H);
    this.olaR.fill(0, N - H);

    this.prevStart = start;
    this.nominal += H * this.rate;
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0];
    const L = out[0];
    if (!L) return true;
    const R = out[1] ?? null;
    const n = L.length;
    L.fill(0);
    R?.fill(0);
    if (!this.playing) {
      this.stepGains();
      return true;
    }

    const right = R ?? this.scratchR;
    if (this.stretching) {
      while (this.fifoLen < n) this.stretchHop();
      L.set(this.fifoL.subarray(0, n));
      right.set(this.fifoR.subarray(0, n));
      this.fifoL.copyWithin(0, n, this.fifoLen);
      this.fifoR.copyWithin(0, n, this.fifoLen);
      this.fifoLen -= n;
      this.stepGains();
      this.pos += n * this.rate;
    } else {
      const start = Math.round(this.pos);
      if (!R) right.fill(0, 0, n);
      this.mix(start, n, L, right, 0, true);
      this.stepGains();
      this.pos = start + n;
    }
    // Mono output: fold both channels together.
    if (!R) for (let i = 0; i < n; i++) L[i] = (L[i] + right[i]) * 0.5;

    // Fade envelope (start, stop, jumps).
    if (this.env !== 1 || this.envTarget !== 1) {
      const step = 1 / FADE;
      for (let i = 0; i < n; i++) {
        if (this.env < this.envTarget) this.env = Math.min(this.envTarget, this.env + step);
        else if (this.env > this.envTarget) this.env = Math.max(this.envTarget, this.env - step);
        L[i] *= this.env;
        if (R) R[i] *= this.env;
      }
      if (this.env === 0 && this.envTarget === 0) {
        if (this.pendingJump != null) {
          this.pos = this.pendingJump;
          this.pendingJump = null;
          this.resetStretch();
          if (!this.stopAfterFade) this.envTarget = 1;
          this.report(true);
        }
        if (this.stopAfterFade) {
          this.playing = false;
          this.stopAfterFade = false;
          this.report(true);
          return true;
        }
      }
    }

    // Loop section, then the end of the piece.
    if (this.loop && this.pendingJump == null && this.pos >= this.loop.to) {
      this.jump(this.loop.from);
      this.port.postMessage({ type: 'looped' });
    } else if (!this.loop && this.endFrames > 0 && this.pos >= this.endFrames) {
      this.pos = this.endFrames;
      this.playing = false;
      this.env = 0;
      this.envTarget = 0;
      this.report(true);
      this.port.postMessage({ type: 'ended' });
      return true;
    }
    this.report();
    return true;
  }
}

registerProcessor('practice-mixer', PracticeMixer);
