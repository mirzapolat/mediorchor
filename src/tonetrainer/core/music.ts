export type NoteNaming = 'de' | 'intl'

const NAMES: Record<NoteNaming, string[]> = {
  de: ['C', 'Cis', 'D', 'Es', 'E', 'F', 'Fis', 'G', 'As', 'A', 'B', 'H'],
  intl: ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'],
}

export function midiToFreq(midi: number, a4 = 440) {
  return a4 * 2 ** ((midi - 69) / 12)
}

export function noteParts(midi: number, naming: NoteNaming = 'de') {
  const rounded = Math.round(midi)
  return { name: NAMES[naming][((rounded % 12) + 12) % 12], octave: Math.floor(rounded / 12) - 1 }
}

export function noteName(midi: number, naming: NoteNaming = 'de') {
  const { name, octave } = noteParts(midi, naming)
  return `${name}${octave}`
}

export function isBlackKey(midi: number) {
  return [1, 3, 6, 8, 10].includes(((Math.round(midi) % 12) + 12) % 12)
}

/** Deviation of a sung pitch from the target in cents; optionally folded into ±600 (octave ignored). */
export function centsOff(sung: number, target: number, ignoreOctave: boolean) {
  const c = (sung - target) * 100
  if (!ignoreOctave) return c
  return ((((c + 600) % 1200) + 1200) % 1200) - 600
}
