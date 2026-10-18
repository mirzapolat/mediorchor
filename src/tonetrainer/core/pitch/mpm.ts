import { FFT } from './fft'

export interface PitchEstimate {
  freq: number
  /** Height of the normalized square difference peak, 0..1. Voice usually > 0.9, noise < 0.6. */
  clarity: number
}

export interface MpmOptions {
  sampleRate: number
  bufferSize: number
  minFreq?: number
  maxFreq?: number
  /** Fraction of the highest key maximum a candidate needs to be chosen (McLeod's k). */
  cutoff?: number
}

/**
 * McLeod Pitch Method (McLeod & Wyvill, "A Smarter Way to Find Pitch", 2005).
 *
 * Works on the normalized square difference function rather than the spectrum, which makes it far
 * more robust for singing than picking the strongest FFT bin: voices often have a weaker
 * fundamental than their 2nd/3rd harmonic, and the spectral peak then reports the wrong octave.
 * The autocorrelation part is computed via FFT, so a 2048-sample frame costs well under 1 ms.
 */
export class McLeodDetector {
  private readonly n: number
  private readonly sr: number
  private readonly fft: FFT
  private readonly re: Float64Array
  private readonly im: Float64Array
  private readonly nsdf: Float64Array
  private readonly x: Float64Array
  private readonly tauMin: number
  private readonly tauMax: number
  private readonly cutoff: number

  constructor(opts: MpmOptions) {
    this.n = opts.bufferSize
    this.sr = opts.sampleRate
    this.fft = new FFT(nextPow2(this.n * 2))
    this.re = new Float64Array(this.fft.size)
    this.im = new Float64Array(this.fft.size)
    this.nsdf = new Float64Array(this.n)
    this.x = new Float64Array(this.n)
    this.tauMin = Math.max(2, Math.floor(this.sr / (opts.maxFreq ?? 1500)))
    this.tauMax = Math.min(this.n - 2, Math.ceil(this.sr / (opts.minFreq ?? 60)))
    this.cutoff = opts.cutoff ?? 0.9
  }

  detect(input: ArrayLike<number>): PitchEstimate | null {
    const n = this.n
    const { re, im, nsdf, x } = this

    let mean = 0
    for (let i = 0; i < n; i++) mean += input[i]
    mean /= n
    for (let i = 0; i < n; i++) x[i] = input[i] - mean

    // Autocorrelation r(τ) = IFFT(|FFT(x)|²), zero padded to avoid circular wrap-around.
    re.fill(0)
    im.fill(0)
    for (let i = 0; i < n; i++) re[i] = x[i]
    this.fft.transform(re, im)
    for (let i = 0; i < re.length; i++) {
      re[i] = re[i] * re[i] + im[i] * im[i]
      im[i] = 0
    }
    this.fft.transform(re, im, true)
    const scale = 1 / re.length

    // m(τ) = Σ x[j]² + x[j+τ]², updated incrementally.
    let m = 0
    for (let i = 0; i < n; i++) m += 2 * x[i] * x[i]
    if (m < 1e-9) return null
    nsdf[0] = 1
    for (let tau = 1; tau < n; tau++) {
      m -= x[tau - 1] * x[tau - 1] + x[n - tau] * x[n - tau]
      nsdf[tau] = m > 1e-12 ? (2 * re[tau] * scale) / m : 0
    }

    // Key maxima: highest point of every positive lobe after the first negative zero crossing.
    const peaks: number[] = []
    let tau = 1
    while (tau < this.tauMax && nsdf[tau] > 0) tau++
    while (tau < this.tauMax && nsdf[tau] <= 0) tau++
    while (tau < this.tauMax) {
      if (nsdf[tau] > 0) {
        let peak = tau
        while (tau < this.tauMax && nsdf[tau] > 0) {
          if (nsdf[tau] > nsdf[peak]) peak = tau
          tau++
        }
        if (peak >= this.tauMin) peaks.push(peak)
      } else tau++
    }
    if (!peaks.length) return null
    let highest = 0
    for (const p of peaks) highest = Math.max(highest, nsdf[p])
    const threshold = this.cutoff * highest
    const best = peaks.find((p) => nsdf[p] >= threshold)!

    // Parabolic interpolation around the chosen lag for sub-sample accuracy.
    const a = nsdf[best - 1]
    const b = nsdf[best]
    const c = nsdf[best + 1]
    const denom = a - 2 * b + c
    const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0
    const lag = best + shift
    const clarity = Math.min(1, b - 0.25 * (a - c) * shift)
    return { freq: this.sr / lag, clarity }
  }
}

export function nextPow2(v: number) {
  let p = 1
  while (p < v) p <<= 1
  return p
}
