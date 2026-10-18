export interface ParsedNote {
  measureIndex: number
  /** Start within the measure, in quarter notes. */
  offsetQ: number
  durQ: number
  /** Sounding pitch (written pitch + <transpose>). */
  midi: number
  lyric?: string
  /** Syllable continues into the next one (syllabic begin/middle). */
  lyricJoin?: boolean
}

export interface ParsedTrack {
  id: string
  partIndex: number
  voice: string
  name: string
  /** One note at a time (highest of a chord) – what the singer is graded against. */
  notes: ParsedNote[]
  /** Every note including chord tones – what playback uses. */
  playNotes: ParsedNote[]
}

export interface ParsedMeasure {
  index: number
  number: string
  lengthQ: number
  tempos: { offsetQ: number; bpm: number }[]
}

export interface ParsedScore {
  title: string
  composer: string
  measures: ParsedMeasure[]
  tracks: ParsedTrack[]
}

const STEPS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const BEAT_UNIT_Q: Record<string, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 }

const kids = (el: Element, tag: string) => Array.from(el.children).filter((c) => c.tagName === tag)
const kid = (el: Element, tag: string) => Array.from(el.children).find((c) => c.tagName === tag)
const num = (el: Element | undefined, fallback = 0) => {
  const v = el ? parseFloat(el.textContent ?? '') : NaN
  return Number.isFinite(v) ? v : fallback
}

export function parseScore(xml: string): ParsedScore {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('Die Datei ist kein gültiges XML.')
  const root = doc.documentElement
  if (root.tagName === 'score-timewise') throw new Error('„score-timewise“-MusicXML wird nicht unterstützt. Bitte als normales MusicXML exportieren.')
  if (root.tagName !== 'score-partwise') throw new Error('Die Datei enthält keine MusicXML-Partitur.')

  const title =
    doc.querySelector('work > work-title')?.textContent?.trim() ||
    doc.querySelector('movement-title')?.textContent?.trim() ||
    doc.querySelector('credit-words')?.textContent?.trim() ||
    'Ohne Titel'
  const composer = doc.querySelector('identification > creator[type="composer"]')?.textContent?.trim() ?? ''

  const partNames = new Map<string, string>()
  for (const sp of doc.querySelectorAll('part-list > score-part')) {
    const name = sp.querySelector('part-name')?.textContent?.trim() || sp.querySelector('part-abbreviation')?.textContent?.trim()
    partNames.set(sp.getAttribute('id') ?? '', name || '')
  }

  const lengths: number[] = []
  const nominal: number[] = []
  const numbers: string[] = []
  const tempos = new Map<number, Map<number, number>>()
  const tracks: ParsedTrack[] = []

  kids(root, 'part').forEach((partEl, partIndex) => {
    const partId = partEl.getAttribute('id') ?? `P${partIndex + 1}`
    let divisions = 1
    let transpose = 0
    let nominalQ = 4
    const voices = new Map<string, { melody: ParsedNote[]; all: ParsedNote[]; lastMelody?: ParsedNote }>()
    // A tied note may live both in playback and melody lists; both copies get extended.
    const openTies = new Map<string, ParsedNote[]>()

    kids(partEl, 'measure').forEach((mEl, mi) => {
      numbers[mi] ??= mEl.getAttribute('number') ?? String(mi + 1)
      let pos = 0
      let maxPos = 0
      let chordStart = 0
      const addTempo = (bpm: number) => {
        if (!(bpm > 0)) return
        if (!tempos.has(mi)) tempos.set(mi, new Map())
        const m = tempos.get(mi)!
        const off = pos / divisions
        if (!m.has(off)) m.set(off, bpm)
      }

      for (const el of Array.from(mEl.children)) {
        switch (el.tagName) {
          case 'attributes': {
            divisions = num(kid(el, 'divisions'), divisions) || divisions
            const time = kid(el, 'time')
            if (time && kid(time, 'beats')) {
              const beats = (kid(time, 'beats')!.textContent ?? '4').split('+').reduce((a, b) => a + (parseFloat(b) || 0), 0)
              nominalQ = (beats * 4) / num(kid(time, 'beat-type'), 4)
            }
            const tr = kid(el, 'transpose')
            if (tr) transpose = num(kid(tr, 'chromatic')) + 12 * num(kid(tr, 'octave-change'))
            break
          }
          case 'backup':
            pos = Math.max(0, pos - num(kid(el, 'duration')))
            break
          case 'forward':
            pos += num(kid(el, 'duration'))
            maxPos = Math.max(maxPos, pos)
            break
          case 'sound':
            addTempo(parseFloat(el.getAttribute('tempo') ?? ''))
            break
          case 'direction': {
            const sound = kid(el, 'sound')
            const bpm = parseFloat(sound?.getAttribute('tempo') ?? '')
            if (bpm > 0) addTempo(bpm)
            else {
              const met = el.querySelector('metronome')
              const perMinute = num(met?.querySelector('per-minute') ?? undefined)
              const unit = met?.querySelector('beat-unit')?.textContent ?? 'quarter'
              const dotted = !!met?.querySelector('beat-unit-dot')
              if (perMinute > 0) addTempo(perMinute * (BEAT_UNIT_Q[unit] ?? 1) * (dotted ? 1.5 : 1))
            }
            break
          }
          case 'note': {
            if (kid(el, 'grace')) break
            const dur = num(kid(el, 'duration'))
            const isChord = !!kid(el, 'chord')
            const start = isChord ? chordStart : pos
            if (!isChord) {
              chordStart = pos
              pos += dur
              maxPos = Math.max(maxPos, pos)
            }
            const pitch = kid(el, 'pitch')
            if (kid(el, 'rest') || kid(el, 'cue') || !pitch) break

            const voice = kid(el, 'voice')?.textContent?.trim() || '1'
            if (!voices.has(voice)) voices.set(voice, { melody: [], all: [] })
            const v = voices.get(voice)!
            const written = (num(kid(pitch, 'octave'), 4) + 1) * 12 + (STEPS[kid(pitch, 'step')?.textContent?.trim() ?? 'C'] ?? 0) + Math.round(num(kid(pitch, 'alter')))
            const midi = written + transpose
            const ties = kids(el, 'tie').map((t) => t.getAttribute('type'))
            const tieKey = `${voice}:${midi}`

            const open = openTies.get(tieKey)
            if (ties.includes('stop') && open) {
              for (const n of open) n.durQ += dur / divisions
              if (!ties.includes('start')) openTies.delete(tieKey)
              break
            }

            const note: ParsedNote = { measureIndex: mi, offsetQ: start / divisions, durQ: dur / divisions, midi }
            const lyricEl = kids(el, 'lyric').find((l) => (l.getAttribute('number') ?? '1') === '1') ?? kid(el, 'lyric')
            if (lyricEl) {
              const text = kids(lyricEl, 'text').map((t) => t.textContent ?? '').join('').trim()
              if (text) {
                note.lyric = text
                const syl = kid(lyricEl, 'syllabic')?.textContent
                note.lyricJoin = syl === 'begin' || syl === 'middle'
              }
            }
            v.all.push(note)
            const tied = [note]
            const last = v.lastMelody
            if (isChord && last && last.measureIndex === mi && last.offsetQ === note.offsetQ) {
              if (midi > last.midi) {
                last.midi = midi
                last.durQ = note.durQ
                tied.push(last)
              }
            } else {
              v.lastMelody = { ...note }
              v.melody.push(v.lastMelody)
              tied.push(v.lastMelody)
            }
            if (ties.includes('start')) openTies.set(tieKey, tied)
            break
          }
        }
      }
      lengths[mi] = Math.max(lengths[mi] ?? 0, maxPos / divisions)
      nominal[mi] ??= nominalQ
    })

    const used = [...voices.entries()].filter(([, v]) => v.melody.length > 0)
    const baseName = partNames.get(partId) || `Stimme ${partIndex + 1}`
    used.forEach(([voice, v], k) => {
      const byTime = (a: ParsedNote, b: ParsedNote) => a.measureIndex - b.measureIndex || a.offsetQ - b.offsetQ
      tracks.push({
        id: `${partIndex}:${voice}`,
        partIndex,
        voice,
        name: used.length > 1 ? `${baseName} (${k + 1}. Stimme)` : baseName,
        notes: [...v.melody].sort(byTime),
        playNotes: [...v.all].sort(byTime),
      })
    })
  })

  if (!tracks.length) throw new Error('In der Partitur wurden keine Noten gefunden.')

  const measures: ParsedMeasure[] = lengths.map((len, i) => ({
    index: i,
    number: numbers[i] ?? String(i + 1),
    lengthQ: len > 0 ? len : nominal[i] ?? 4,
    tempos: [...(tempos.get(i)?.entries() ?? [])].map(([offsetQ, bpm]) => ({ offsetQ, bpm })).sort((a, b) => a.offsetQ - b.offsetQ),
  }))

  return { title, composer, measures, tracks }
}
