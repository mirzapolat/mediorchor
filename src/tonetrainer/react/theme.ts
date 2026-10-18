import { useLayoutEffect, useState, type RefObject } from 'react'
import type { Grade } from '../core/types'

/**
 * Colours used by canvas (piano roll), SVG (tuner) and the engraved score. They are read from CSS
 * custom properties on the trainer root, so restyling happens in CSS only (see tonetrainer.css).
 */
export interface TrainerColors {
  tune: string
  flat: string
  sharp: string
  silent: string
  ok: string
  accent: string
  accentGlow: string
  free: string
  rollUpcoming: string
  rollPast: string
  rollOther: string
  rollRowShade: string
  rollGrid: string
  rollMeasure: string
  rollLabel: string
  rollLabelStrong: string
  rollLoop: string
  rollNoteText: string
  rollNoteTextCurrent: string
  scoreInk: string
  scoreOther: string
  scoreCursor: string
  paperGood: string
  paperOk: string
  paperFlat: string
  paperSharp: string
  paperSilent: string
}

const VARS: Record<keyof TrainerColors, [string, string]> = {
  tune: ['--tt-tune', 'transparent'],
  flat: ['--tt-flat', 'transparent'],
  sharp: ['--tt-sharp', 'transparent'],
  silent: ['--tt-silent', 'transparent'],
  ok: ['--tt-ok', 'transparent'],
  accent: ['--tt-accent', 'transparent'],
  accentGlow: ['--tt-accent-glow', 'transparent'],
  free: ['--tt-free', 'transparent'],
  rollUpcoming: ['--tt-roll-upcoming', 'transparent'],
  rollPast: ['--tt-roll-past', 'transparent'],
  rollOther: ['--tt-roll-other', 'transparent'],
  rollRowShade: ['--tt-roll-row-shade', 'transparent'],
  rollGrid: ['--tt-roll-grid', 'transparent'],
  rollMeasure: ['--tt-roll-measure', 'transparent'],
  rollLabel: ['--tt-roll-label', 'transparent'],
  rollLabelStrong: ['--tt-roll-label-strong', 'transparent'],
  rollLoop: ['--tt-roll-loop', 'transparent'],
  rollNoteText: ['--tt-roll-note-text', 'transparent'],
  rollNoteTextCurrent: ['--tt-roll-note-text-current', 'transparent'],
  scoreInk: ['--tt-score-ink', 'transparent'],
  scoreOther: ['--tt-score-other', 'transparent'],
  scoreCursor: ['--tt-score-cursor', 'transparent'],
  paperGood: ['--tt-paper-good', 'transparent'],
  paperOk: ['--tt-paper-ok', 'transparent'],
  paperFlat: ['--tt-paper-flat', 'transparent'],
  paperSharp: ['--tt-paper-sharp', 'transparent'],
  paperSilent: ['--tt-paper-silent', 'transparent'],
}

export function readColors(el: Element = document.documentElement): TrainerColors {
  const cs = getComputedStyle(el)
  const out = {} as TrainerColors
  for (const [k, [v, fallback]] of Object.entries(VARS) as [keyof TrainerColors, [string, string]][]) {
    out[k] = cs.getPropertyValue(v).trim() || fallback
  }
  return out
}

export const DEFAULT_COLORS: TrainerColors = Object.fromEntries(Object.entries(VARS).map(([k, [, f]]) => [k, f])) as unknown as TrainerColors

/**
 * Reads the colours once the root element is mounted (and again when `deps` change, e.g. a theme
 * switch). Returns null until then, so the score is not engraved with fallback colours.
 */
export function useTrainerColors(root: RefObject<Element | null>, deps: unknown[] = []) {
  const [colors, setColors] = useState<TrainerColors | null>(null)
  useLayoutEffect(() => {
    if (root.current) setColors(readColors(root.current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return colors
}

export function gradeColor(c: TrainerColors, g: Grade) {
  return { good: c.tune, ok: c.ok, flat: c.flat, sharp: c.sharp, silent: c.silent }[g]
}

/** Grade colours tuned for the white score paper. */
export function paperGradeColor(c: TrainerColors, g: Grade) {
  return { good: c.paperGood, ok: c.paperOk, flat: c.paperFlat, sharp: c.paperSharp, silent: c.paperSilent }[g]
}

/** Colour for an accuracy value 0..1 (results, heatmap). */
export function accuracyColor(c: TrainerColors, acc: number) {
  return acc >= 0.85 ? c.tune : acc >= 0.6 ? c.ok : c.sharp
}
