// Practice playback on the Web Audio clock: any number of voices in perfect
// sync, each at its own volume, at any speed (pitch kept), with a loop
// section. The mixing itself happens in mixer.worklet.ts; this side loads
// and decodes the recordings, keeps the transport state, and deals with the
// browsers (iPhone's silent switch and lock screen, interruptions).
//
// Why not <audio> elements: several of them drift apart, stall on a slow
// network and stop on their own (a shorter file ends, iOS suspends one).
// Here every recording is decoded completely before it is heard and one
// playhead reads them all.
import workletUrl from './mixer.worklet.ts?worker&url';

export type SourceStatus = 'loading' | 'ready' | 'error';

export interface SourceState {
  status: SourceStatus;
  // 0…1 while loading.
  progress: number;
}

export interface EngineVoice {
  id: string;
  // The recording to play (null: none); a change swaps it seamlessly.
  url: string | null;
  // Seconds before bar one in this recording.
  leadIn: number;
  // Linear gain (0 = silent; the voice stays loaded).
  gain: number;
}

interface Source extends SourceState {
  frames: number;
  promise: Promise<void> | null;
  tries: number;
}

interface WorkletState {
  pos: number; // frames
  frame: number; // audio-clock frame of that report
  playing: boolean;
  rate: number;
}

const AudioContextCtor: typeof AudioContext | undefined =
  typeof window === 'undefined'
    ? undefined
    : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);

export const playbackSupported = () => Boolean(AudioContextCtor && typeof AudioWorkletNode !== 'undefined');

// One second of silence as a WAV file: played in a loop by an <audio>
// element while practising, so iOS treats the page as media playback (the
// silent switch doesn't mute it; lock-screen controls and playing on with
// the screen off work).
const silentWav = () => {
  const rate = 8000;
  const frames = rate;
  const buf = new ArrayBuffer(44 + frames * 2);
  const v = new DataView(buf);
  const s = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  s(0, 'RIFF');
  v.setUint32(4, 36 + frames * 2, true);
  s(8, 'WAVE');
  s(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  s(36, 'data');
  v.setUint32(40, frames * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Downloads with progress; retried by the caller.
const fetchBytes = async (url: string, onProgress: (f: number) => void, signal: AbortSignal): Promise<ArrayBuffer> => {
  const res = await fetch(url, { credentials: 'same-origin', signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(Math.min(0.9, (got / total) * 0.9));
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out.buffer;
};

// Float samples → 16 bit (half the memory; the recordings are MP3s anyway).
const toInt16 = (data: Float32Array[], mono: boolean): Int16Array[] => {
  const frames = data[0]?.length ?? 0;
  const conv = (get: (i: number) => number) => {
    const out = new Int16Array(frames);
    for (let i = 0; i < frames; i++) {
      const x = get(i);
      out[i] = x >= 1 ? 32767 : x <= -1 ? -32768 : Math.round(x * 32767);
    }
    return out;
  };
  if (data.length === 1) return [conv((i) => data[0][i])];
  if (mono) return [conv((i) => (data[0][i] + data[1][i]) * 0.5)];
  return [conv((i) => data[0][i]), conv((i) => data[1][i])];
};

export class PlaybackEngine {
  readonly ctx: AudioContext;
  private node: AudioWorkletNode | null = null;
  private failed = false;
  private sources = new Map<string, Source>();
  // Decoded samples waiting for the worklet (sent over, then dropped here).
  private stored = new Map<string, Int16Array[]>();
  private queue: string[] = [];
  private active = 0;
  // Decoding strictly one after the other keeps the memory peak low.
  private decoding: Promise<void> = Promise.resolve();
  private voices: EngineVoice[] = [];
  private sentVoices = new Set<string>();
  private minEnd = 0;
  private endFrames = 0;
  private state: WorkletState = { pos: 0, frame: 0, playing: false, rate: 1 };
  // Where the current run started (latency compensation never shows less).
  private runStart = 0;
  private wantPlay = false;
  private loop: { from: number; to: number } | null = null;
  private keepAlive: HTMLAudioElement | null = null;
  private keepAliveUrl: string | null = null;
  private abort = new AbortController();
  private destroyed = false;
  // Stereo only for one or two voices (likely a real recording); otherwise
  // mono keeps the memory in check on phones.
  mono = false;
  onChange: () => void = () => undefined;
  onEnded: () => void = () => undefined;

  constructor() {
    if (!AudioContextCtor) throw new Error('Web Audio unavailable');
    this.ctx = new AudioContextCtor({ latencyHint: 'playback' });
    // iOS 17+: play like a media app (not muted by the silent switch).
    try {
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = 'playback';
    } catch {
      /* unsupported */
    }
    void this.ctx.audioWorklet
      .addModule(workletUrl)
      .then(() => {
        if (this.destroyed) return;
        const node = new AudioWorkletNode(this.ctx, 'practice-mixer', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        // A safety limiter: loud passages of many voices never clip.
        const limiter = this.ctx.createDynamicsCompressor();
        limiter.threshold.value = -1.5;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.002;
        limiter.release.value = 0.12;
        node.connect(limiter).connect(this.ctx.destination);
        node.port.onmessage = (e) => this.onMessage(e.data);
        this.node = node;
        // Hand over what was set before the worklet existed.
        for (const key of [...this.stored.keys()]) this.sendStored(key);
        this.post({ type: 'end', frames: this.endFrames });
        this.syncVoices();
        this.post({ type: 'rate', value: this.state.rate });
        this.sendLoop();
        this.maybeStart();
      })
      .catch(() => {
        this.failed = true;
        this.onChange();
      });
    this.ctx.onstatechange = () => {
      // An interruption (call, Siri, another app) pauses; play resumes.
      if (this.ctx.state !== 'running' && this.state.playing) this.pause();
      this.onChange();
    };
  }

  // The browser couldn't start the mixer.
  get unsupported() {
    return this.failed;
  }

  get sampleRate() {
    return this.ctx.sampleRate;
  }

  private post(msg: unknown, transfer: Transferable[] = []) {
    this.node?.port.postMessage(msg, transfer);
  }

  private sendStored(key: string) {
    const channels = this.stored.get(key);
    if (!channels || !this.node) return;
    // Hand the samples over without a copy; this side keeps no PCM.
    this.post({ type: 'source', key, channels }, channels.map((c) => c.buffer));
    this.stored.delete(key);
  }

  private onMessage(m: { type: string } & Partial<WorkletState>) {
    if (m.type === 'state') {
      const wasPlaying = this.state.playing;
      this.state = { pos: m.pos ?? 0, frame: m.frame ?? 0, playing: Boolean(m.playing), rate: m.rate ?? 1 };
      if (!wasPlaying && this.state.playing) this.runStart = this.state.pos / this.sampleRate;
      if (wasPlaying !== this.state.playing) {
        if (!this.state.playing) this.keepAlive?.pause();
        this.onChange();
      }
    } else if (m.type === 'ended') {
      this.state = { ...this.state, playing: false };
      this.wantPlay = false;
      this.keepAlive?.pause();
      this.onEnded();
      this.onChange();
    }
  }

  // --- Sources -------------------------------------------------------------

  source(url: string | null): SourceState | null {
    if (!url) return null;
    const s = this.sources.get(url);
    return s ? { status: s.status, progress: s.progress } : { status: 'loading', progress: 0 };
  }

  private request(url: string) {
    let s = this.sources.get(url);
    if (!s) {
      s = { status: 'loading', progress: 0, frames: 0, promise: null, tries: 0 };
      this.sources.set(url, s);
    }
    if (s.status !== 'loading' || s.promise || this.queue.includes(url)) return;
    this.queue.push(url);
    this.pump();
  }

  // Two downloads at a time.
  private pump() {
    while (this.active < 2 && this.queue.length > 0) {
      const url = this.queue.shift()!;
      const s = this.sources.get(url);
      if (!s || s.status !== 'loading' || s.promise) continue;
      this.active++;
      s.promise = this.load(url, s).finally(() => {
        s.promise = null;
        this.active--;
        this.pump();
      });
    }
  }

  private async load(url: string, s: Source) {
    for (;;) {
      try {
        const bytes = await fetchBytes(
          url,
          (f) => {
            s.progress = f;
            this.onChange();
          },
          this.abort.signal,
        );
        const turn = this.decoding.then(async () => {
          const buffer = await this.ctx.decodeAudioData(bytes);
          const data = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c));
          s.frames = buffer.length;
          this.stored.set(url, toInt16(data, this.mono));
          this.sendStored(url);
        });
        this.decoding = turn.catch(() => undefined);
        await turn;
        if (this.destroyed) return;
        s.status = 'ready';
        s.progress = 1;
        this.updateEnd();
        this.syncVoices();
        this.onChange();
        this.maybeStart();
        return;
      } catch (err) {
        if (this.destroyed || (err as Error).name === 'AbortError') return;
        s.tries++;
        if (s.tries >= 4) {
          s.status = 'error';
          this.onChange();
          this.maybeStart();
          return;
        }
        await sleep(500 * 2 ** s.tries);
      }
    }
  }

  retry(url: string) {
    const s = this.sources.get(url);
    if (s?.status !== 'error') return;
    s.status = 'loading';
    s.progress = 0;
    s.tries = 0;
    this.request(url);
    this.onChange();
  }

  // --- Voices --------------------------------------------------------------

  // The voices to mix, all of them (silent ones too, so switching one on is
  // instant). `minEnd`: the piece lasts at least this long (its last bar).
  setVoices(voices: EngineVoice[], minEnd = 0) {
    this.voices = voices;
    this.minEnd = minEnd;
    // Heard voices load first.
    for (const v of voices) if (v.url && v.gain > 0) this.request(v.url);
    for (const v of voices) if (v.url && v.gain <= 0) this.request(v.url);
    this.updateEnd();
    this.syncVoices();
    this.maybeStart();
  }

  // Piece time zero is where the voice with the longest lead-in starts;
  // the others are delayed so all bar ones coincide.
  get leadIn() {
    return this.voices.reduce((m, v) => Math.max(m, v.leadIn), 0);
  }

  private shiftOf(v: EngineVoice) {
    return Math.round((this.leadIn - v.leadIn) * this.sampleRate);
  }

  private syncVoices() {
    const ids = new Set(this.voices.map((v) => v.id));
    for (const id of this.sentVoices) if (!ids.has(id)) this.post({ type: 'dropVoice', id });
    this.sentVoices = ids;
    for (const v of this.voices) {
      const ready = Boolean(v.url && this.sources.get(v.url)?.status === 'ready');
      this.post({ type: 'voice', id: v.id, source: ready ? v.url : null, shift: this.shiftOf(v), gain: v.gain });
    }
  }

  private updateEnd() {
    let end = Math.round(this.minEnd * this.sampleRate);
    for (const v of this.voices) {
      const s = v.url ? this.sources.get(v.url) : undefined;
      if (s?.status === 'ready') end = Math.max(end, this.shiftOf(v) + s.frames);
    }
    if (end !== this.endFrames) {
      this.endFrames = end;
      this.post({ type: 'end', frames: end });
      this.onChange();
    }
  }

  // Seconds of the whole piece: its longest recording (known once loaded).
  get duration() {
    return this.endFrames / this.sampleRate;
  }

  // Heard voices still loading (play waits for them).
  get loading() {
    return this.voices.some((v) => v.url && v.gain > 0 && this.sources.get(v.url)?.status === 'loading');
  }

  // Play was pressed; it starts once the heard voices are there.
  get waiting() {
    return this.wantPlay && !this.state.playing;
  }

  // --- Transport -----------------------------------------------------------

  get playing() {
    return this.state.playing;
  }

  get rate() {
    return this.state.rate;
  }

  // The position being heard now, in seconds.
  get position() {
    const sr = this.sampleRate;
    const { pos, frame, playing, rate } = this.state;
    if (!playing) return pos / sr;
    const elapsed = Math.max(0, this.ctx.currentTime - frame / sr);
    // What's computed now reaches the speaker a little later (Bluetooth!).
    const latency = (this.ctx.outputLatency || this.ctx.baseLatency || 0) * rate;
    const t = pos / sr + elapsed * rate - latency;
    return Math.min(this.duration, Math.max(this.runStart, t));
  }

  private startKeepAlive() {
    try {
      if (!this.keepAlive) {
        this.keepAliveUrl = silentWav();
        this.keepAlive = new Audio(this.keepAliveUrl);
        this.keepAlive.loop = true;
      }
      void this.keepAlive.play().catch(() => undefined);
    } catch {
      /* only a helper */
    }
  }

  // Call from the user's tap (browsers only start audio then).
  play() {
    if (this.destroyed) return;
    void this.ctx.resume().catch(() => undefined);
    this.startKeepAlive();
    this.wantPlay = true;
    this.onChange();
    this.maybeStart();
  }

  private maybeStart() {
    if (!this.wantPlay || !this.node || this.state.playing) return;
    if (this.loading || this.endFrames <= 0) return;
    this.wantPlay = false;
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
    let pos = this.state.pos;
    if (pos >= this.endFrames - 1) pos = this.loop ? this.loop.from : 0;
    this.state = { ...this.state, pos, frame: Math.round(this.ctx.currentTime * this.sampleRate), playing: true };
    this.runStart = pos / this.sampleRate;
    this.post({ type: 'play', pos });
    this.onChange();
  }

  pause() {
    const pos = Math.round(this.position * this.sampleRate);
    this.wantPlay = false;
    this.post({ type: 'pause' });
    this.state = { ...this.state, pos, playing: false };
    this.keepAlive?.pause();
    this.onChange();
  }

  seek(seconds: number) {
    const max = Math.max(0, this.endFrames - 1);
    const pos = Math.max(0, Math.min(max, Math.round(seconds * this.sampleRate)));
    this.post({ type: 'seek', pos });
    this.state = { ...this.state, pos, frame: Math.round(this.ctx.currentTime * this.sampleRate) };
    this.runStart = pos / this.sampleRate;
    this.onChange();
  }

  setRate(rate: number) {
    const pos = Math.round(this.position * this.sampleRate);
    this.post({ type: 'rate', value: rate });
    this.state = { ...this.state, pos, frame: Math.round(this.ctx.currentTime * this.sampleRate), rate };
    this.runStart = pos / this.sampleRate;
    this.onChange();
  }

  // Loop section in seconds (null: none).
  setLoop(range: { from: number; to: number } | null) {
    const sr = this.sampleRate;
    this.loop = range ? { from: Math.round(range.from * sr), to: Math.round(range.to * sr) } : null;
    this.sendLoop();
  }

  private sendLoop() {
    this.post(this.loop ? { type: 'loop', ...this.loop } : { type: 'loop', from: null, to: null });
  }

  destroy() {
    this.destroyed = true;
    this.abort.abort();
    this.keepAlive?.pause();
    if (this.keepAliveUrl) URL.revokeObjectURL(this.keepAliveUrl);
    this.node?.disconnect();
    void this.ctx.close().catch(() => undefined);
  }
}
