import { nextPow2 } from '../pitch/mpm'
import { PitchTracker, type TrackerFrame } from '../pitch/tracker'

export interface MicOptions {
  deviceId?: string | null
  /**
   * Browser echo cancellation removes our own playback from the mic signal when singing without
   * headphones. It slightly colours the voice, so it stays off when headphones are used.
   */
  echoCancellation: boolean
  a4: number
  minClarity: number
}

export class Mic {
  readonly ctx: AudioContext
  readonly tracker: PitchTracker
  /** Delay between sound reaching the mic and the analysis window's centre, in seconds. */
  readonly latency: number
  private readonly stream: MediaStream
  private readonly source: MediaStreamAudioSourceNode
  private readonly analyser: AnalyserNode
  private readonly buf: Float32Array<ArrayBuffer>

  private constructor(ctx: AudioContext, stream: MediaStream, opts: MicOptions) {
    this.ctx = ctx
    this.stream = stream
    this.source = ctx.createMediaStreamSource(stream)
    const highpass = ctx.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = 45
    this.analyser = ctx.createAnalyser()
    // ~45 ms window: long enough for two periods of a low bass C2 (65 Hz), short enough to follow melismas.
    this.analyser.fftSize = Math.min(32768, nextPow2(ctx.sampleRate * 0.042))
    this.analyser.smoothingTimeConstant = 0
    this.source.connect(highpass).connect(this.analyser)
    this.buf = new Float32Array(this.analyser.fftSize)
    this.tracker = new PitchTracker({
      sampleRate: ctx.sampleRate,
      bufferSize: this.analyser.fftSize,
      a4: opts.a4,
      minClarity: opts.minClarity,
    })
    this.latency = this.analyser.fftSize / 2 / ctx.sampleRate + (ctx.baseLatency || 0.01)
  }

  static async open(ctx: AudioContext, opts: MicOptions) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Dieser Browser erlaubt keinen Mikrofonzugriff. Öffne die App über https:// oder localhost.')
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined,
        echoCancellation: opts.echoCancellation,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    })
    return new Mic(ctx, stream, opts)
  }

  read(): TrackerFrame {
    this.analyser.getFloatTimeDomainData(this.buf)
    return this.tracker.process(this.buf)
  }

  get deviceLabel() {
    return this.stream.getAudioTracks()[0]?.label ?? ''
  }

  close() {
    this.source.disconnect()
    for (const t of this.stream.getTracks()) t.stop()
  }
}

export async function listMics() {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === 'audioinput')
}
