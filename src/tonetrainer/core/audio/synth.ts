import { midiToFreq } from '../music'

let shared: AudioContext | null = null

/** One AudioContext for mic and playback; must first be resumed from a user gesture (iOS). */
export function audioContext() {
  shared ??= new AudioContext({ latencyHint: 'interactive' })
  return shared
}

export interface Voice {
  stop(at?: number): void
}

/**
 * A soft, vowel-ish tone: sawtooth + slightly detuned triangle through a low-pass filter, with a
 * delayed gentle vibrato. Clearly pitched (easy to match) without the harshness of a raw oscillator.
 */
export function playTone(ctx: AudioContext, dest: AudioNode, midi: number, when: number, dur: number, a4 = 440, level = 0.22): Voice {
  const f = midiToFreq(midi, a4)
  const end = when + Math.max(dur, 0.06)

  const env = ctx.createGain()
  env.gain.setValueAtTime(0, when)
  env.gain.linearRampToValueAtTime(level, when + 0.03)
  env.gain.setTargetAtTime(level * 0.75, when + 0.03, 0.15)
  env.gain.setTargetAtTime(0, end - 0.02, 0.04)

  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = Math.min(f * 4.5, 5000)
  filter.Q.value = 0.6

  const saw = ctx.createOscillator()
  saw.type = 'sawtooth'
  saw.frequency.value = f
  const sawGain = ctx.createGain()
  sawGain.gain.value = 0.45
  const tri = ctx.createOscillator()
  tri.type = 'triangle'
  tri.frequency.value = f
  tri.detune.value = 4

  const lfo = ctx.createOscillator()
  lfo.frequency.value = 5.2
  const lfoDepth = ctx.createGain()
  lfoDepth.gain.setValueAtTime(0, when)
  lfoDepth.gain.linearRampToValueAtTime(f * 0.0035, when + 0.6)
  lfo.connect(lfoDepth)
  lfoDepth.connect(saw.frequency)
  lfoDepth.connect(tri.frequency)

  saw.connect(sawGain).connect(filter)
  tri.connect(filter)
  filter.connect(env).connect(dest)

  const oscs = [saw, tri, lfo]
  for (const o of oscs) {
    o.start(when)
    o.stop(end + 0.25)
  }
  saw.onended = () => env.disconnect()

  return {
    stop(at = ctx.currentTime) {
      env.gain.cancelScheduledValues(at)
      env.gain.setTargetAtTime(0, at, 0.03)
      // A later stop() call replaces the earlier scheduled one.
      for (const o of oscs) o.stop(Math.max(at, when) + 0.2)
    },
  }
}

export function playClick(ctx: AudioContext, dest: AudioNode, when: number, accent: boolean) {
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.frequency.value = accent ? 1760 : 1320
  g.gain.setValueAtTime(accent ? 0.35 : 0.22, when)
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06)
  osc.connect(g).connect(dest)
  osc.start(when)
  osc.stop(when + 0.08)
}
