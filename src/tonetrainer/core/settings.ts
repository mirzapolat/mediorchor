import type { NoteNaming } from './music'

export type Sensitivity = 'tolerant' | 'normal' | 'strict'

/** Minimum MPM clarity per sensitivity level. */
export const CLARITY: Record<Sensitivity, number> = { tolerant: 0.8, normal: 0.86, strict: 0.92 }

/** User settings for the trainer. Global (not per score). */
export interface PracticeSettings {
  /** Cents within which a note counts as hit. */
  tolerance: number
  ignoreOctave: boolean
  /** Without headphones: echo cancellation on and playback pitches are filtered from the mic. */
  headphones: boolean
  naming: NoteNaming
  a4: number
  micDeviceId: string | null
  /** Speakers/headphones for playback; null = system default. Only where AudioContext.setSinkId exists. */
  outputDeviceId: string | null
  countIn: boolean
  metronome: boolean
  /** Wait mode: play each new target note briefly. */
  refTone: boolean
  sensitivity: Sensitivity
  showAllParts: boolean
  /** Phones have little room for the score, so only the own voice is shown by default. */
  showAllPartsMobile: boolean
}

export const DEFAULT_SETTINGS: PracticeSettings = {
  tolerance: 35,
  ignoreOctave: false,
  headphones: true,
  naming: 'de',
  a4: 440,
  micDeviceId: null,
  outputDeviceId: null,
  countIn: true,
  metronome: false,
  refTone: true,
  sensitivity: 'normal',
  showAllParts: true,
  showAllPartsMobile: false,
}
