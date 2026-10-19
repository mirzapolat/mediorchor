import { Minus, Plus, User, Users } from 'lucide-react'
import { OpenSheetMusicDisplay, type Cursor } from 'opensheetmusicdisplay'
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import type { TrainerColors } from './theme'

type Iter = Cursor['iterator']

interface Step {
  offsetQ: number
  iter: Iter
}

export interface ScoreHandle {
  /** Moves the cursor to the entry at (or just before) `offsetQ` within the given visit. */
  setPosition(visit: number, offsetQ: number): void
  colorNote(partIndex: number, voice: string, measureIndex: number, offsetQ: number, color: string | null): void
}

interface Props {
  /** The handle (not `ref`: React 18 keeps `ref` from function components). */
  handle: Ref<ScoreHandle>
  xml: string
  ownPartIndex: number
  showAllParts: boolean
  zoom: number
  colors: TrainerColors
  onZoom: (z: number) => void
  onShowAllParts: (v: boolean) => void
  /** Called after each render; `order` is the measure play order including repeats and voltas. */
  onLayout: (order: number[]) => void
  onMeasureClick: (measureIndex: number) => void
}

const key = (pi: number, voice: string, mi: number, off: number) => `${pi}:${voice}:${mi}:${off.toFixed(3)}`

/** OSMD takes note and stem colours as #rrggbb; the theme gives rgb(…). */
function hex(color: string) {
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(color)
  return m ? `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}` : color
}

/**
 * The engraved score (OpenSheetMusicDisplay) with a cursor that follows playback and graded notes
 * coloured in place. OSMD's iterator follows repeats and voltas, so one walk over the score yields
 * both the play order (for the Timeline) and the mapping time → cursor position / note → SVG.
 */
export default function ScoreView({ handle, xml, ownPartIndex, showAllParts, zoom, colors, onZoom, onShowAllParts, onLayout, onMeasureClick }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null)
  const visitsRef = useRef<Step[][]>([])
  const notesRef = useRef(new Map<string, SVGGElement[]>())
  const colorsRef = useRef(new Map<string, string>())
  const lastStep = useRef<Step | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [rendering, setRendering] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const propsRef = useRef({ ownPartIndex, showAllParts, onLayout, colors })
  propsRef.current = { ownPartIndex, showAllParts, onLayout, colors }

  const paint = (k: string, color: string) => {
    for (const g of notesRef.current.get(k) ?? []) {
      for (const p of g.querySelectorAll('path')) {
        p.setAttribute('fill', color)
        p.setAttribute('stroke', color)
      }
    }
  }

  const baseColor = (k: string) => {
    const { ownPartIndex: own, showAllParts: all, colors: c } = propsRef.current
    return Number(k.split(':')[0]) === own || !all ? c.scoreInk : c.scoreOther
  }

  const layout = () => {
    const osmd = osmdRef.current
    if (!osmd) return
    const cursor = osmd.cursor
    const sheet = osmd.Sheet
    cursor.reset()
    const it = cursor.iterator
    const visits: Step[][] = []
    const notes = new Map<string, SVGGElement[]>()
    const seen = new Set<number>()
    let prevMi = -1
    let prevTs = -1
    let firstVisitOfMeasure = false
    for (let guard = 0; !it.EndReached && guard < 100_000; guard++) {
      const mi = it.CurrentMeasureIndex
      const ts = it.currentTimeStamp.RealValue * 4
      if (mi !== prevMi || ts < prevTs - 1e-6) {
        visits.push([])
        firstVisitOfMeasure = !seen.has(mi)
        seen.add(mi)
      }
      const offsetQ = ts - sheet.SourceMeasures[mi].AbsoluteTimestamp.RealValue * 4
      visits[visits.length - 1].push({ offsetQ, iter: it.clone() })
      if (firstVisitOfMeasure) {
        for (const gn of cursor.GNotesUnderCursor()) {
          const src = gn.sourceNote
          if (!src || src.isRest()) continue
          const pi = sheet.Instruments.indexOf(src.ParentStaff.ParentInstrument)
          const voice = String(src.ParentVoiceEntry.ParentVoice.VoiceId)
          const el = (gn as unknown as { getSVGGElement?: () => SVGGElement }).getSVGGElement?.()
          if (!el) continue
          for (const k of [key(pi, voice, mi, offsetQ), key(pi, '*', mi, offsetQ)]) {
            if (!notes.has(k)) notes.set(k, [])
            if (!notes.get(k)!.includes(el)) notes.get(k)!.push(el)
          }
        }
      }
      prevMi = mi
      prevTs = ts
      it.moveToNext()
    }
    cursor.reset()
    cursor.show()
    visitsRef.current = visits
    notesRef.current = notes
    lastStep.current = null
    for (const k of notes.keys()) if (k.includes(':*:')) paint(k, baseColor(k))
    for (const [k, c] of colorsRef.current) paint(k, c)
    propsRef.current.onLayout(visits.map((v) => (v.length ? v[0].iter.CurrentMeasureIndex : 0)))
  }

  const rerender = () => {
    const osmd = osmdRef.current
    if (!osmd) return
    setRendering(true)
    // Let the spinner paint before OSMD blocks the main thread.
    requestAnimationFrame(() =>
      setTimeout(() => {
        try {
          const { showAllParts: all, ownPartIndex: own, colors: c } = propsRef.current
          osmd.Sheet.Instruments.forEach((inst, i) => (inst.Visible = all || i === own))
          // Whole notes in their voice's colour — heads, stems, flags and
          // beams: the own voice in ink, the others pale.
          const rules = osmd.EngravingRules
          rules.ColoringEnabled = true
          rules.ColorStemsLikeNoteheads = true
          rules.ColorFlags = true
          rules.ColorBeams = true
          const ink = hex(c.scoreInk)
          const other = hex(c.scoreOther)
          for (const measure of osmd.Sheet.SourceMeasures) {
            for (const container of measure.VerticalSourceStaffEntryContainers) {
              for (const entry of container.StaffEntries) {
                if (!entry) continue
                const pi = osmd.Sheet.Instruments.indexOf(entry.ParentStaff.ParentInstrument)
                const color = pi === own || !all ? ink : other
                for (const ve of entry.VoiceEntries) {
                  ve.StemColor = color
                  for (const n of ve.Notes) n.NoteheadColor = color
                }
              }
            }
          }
          osmd.render()
          layout()
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
        }
        setRendering(false)
      }, 0),
    )
  }

  useEffect(() => {
    let cancelled = false
    const c = propsRef.current.colors
    const osmd = new OpenSheetMusicDisplay(hostRef.current!, {
      autoResize: false,
      backend: 'svg',
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawLyricist: false,
      drawCredits: false,
      drawPartNames: true,
      drawPartAbbreviations: true,
      drawMeasureNumbers: true,
      drawingParameters: 'compacttight',
      followCursor: false,
      defaultColorMusic: hex(c.scoreInk),
      cursorsOptions: [{ type: 0, color: hex(c.scoreCursor), alpha: 0.38, follow: false }],
    })
    osmdRef.current = osmd
    osmd
      .load(xml)
      .then(() => {
        if (cancelled) return
        osmd.Zoom = zoom
        setLoaded(true)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
      osmd.clear()
      osmdRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xml])

  useEffect(() => {
    if (!loaded || !osmdRef.current) return
    osmdRef.current.Zoom = zoom
    rerender()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, zoom, showAllParts, ownPartIndex])

  useEffect(() => {
    if (!loaded) return
    let width = hostRef.current!.clientWidth
    let timer = 0
    const ro = new ResizeObserver(() => {
      const w = hostRef.current?.clientWidth ?? width
      if (Math.abs(w - width) < 24) return
      width = w
      clearTimeout(timer)
      timer = window.setTimeout(rerender, 250)
    })
    ro.observe(hostRef.current!)
    return () => {
      ro.disconnect()
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  /** Vertical extent (px, in the scroll box's content) of the own part's staves in a measure; falls back to the cursor. */
  const ownStaffSpan = (mi: number) => {
    const osmd = osmdRef.current
    const box = scrollRef.current
    const svg = hostRef.current?.querySelector('svg')
    if (!osmd || !box || !svg) return null
    const own = osmd.Sheet.Instruments[propsRef.current.ownPartIndex]
    const unit = 10 * osmd.Zoom
    const origin = svg.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
    let top = Infinity
    let bottom = -Infinity
    for (const gm of osmd.GraphicSheet.MeasureList[mi] ?? []) {
      if (!gm || gm.ParentStaff?.ParentInstrument !== own) continue
      const b = gm.PositionAndShape
      top = Math.min(top, origin + (b.AbsolutePosition.y + b.BorderTop) * unit)
      bottom = Math.max(bottom, origin + (b.AbsolutePosition.y + b.BorderBottom) * unit)
    }
    if (top <= bottom) return { top, bottom }
    const el = osmd.cursor.cursorElement
    return el ? { top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight } : null
  }

  useImperativeHandle(handle, () => ({
    setPosition(visit, offsetQ) {
      const steps = visitsRef.current[visit]
      const osmd = osmdRef.current
      if (!steps?.length || !osmd) return
      let step = steps[0]
      for (const s of steps) if (s.offsetQ <= offsetQ + 1e-4) step = s
      if (step === lastStep.current) return
      lastStep.current = step
      try {
        osmd.cursor.iterator = step.iter.clone()
        osmd.cursor.update()
      } catch {
        return
      }
      const box = scrollRef.current
      const span = ownStaffSpan(step.iter.CurrentMeasureIndex)
      if (!box || !span) return
      // Keep the own voice's staff in the middle of the view, even inside tall systems.
      const h = box.clientHeight
      const target = Math.max(0, (span.top + span.bottom) / 2 - h / 2)
      if (Math.abs(target - box.scrollTop) > h * 0.04) box.scrollTo({ top: target, behavior: 'smooth' })
    },
    colorNote(partIndex, voice, measureIndex, offsetQ, color) {
      let k = key(partIndex, voice, measureIndex, offsetQ)
      if (!notesRef.current.has(k)) k = key(partIndex, '*', measureIndex, offsetQ)
      if (color) colorsRef.current.set(k, color)
      else colorsRef.current.delete(k)
      paint(k, color ?? baseColor(k))
    },
  }))

  const handleClick = (e: React.MouseEvent) => {
    const osmd = osmdRef.current
    const svg = hostRef.current?.querySelector('svg')
    if (!osmd || !svg) return
    const r = svg.getBoundingClientRect()
    const unit = 10 * osmd.Zoom
    const x = (e.clientX - r.left) / unit
    const y = (e.clientY - r.top) / unit
    osmd.GraphicSheet.MeasureList.forEach((staves, mi) => {
      for (const gm of staves) {
        if (!gm) continue
        const b = gm.PositionAndShape
        const ax = b.AbsolutePosition.x
        const ay = b.AbsolutePosition.y
        if (x >= ax + b.BorderLeft && x <= ax + b.BorderRight && y >= ay + b.BorderTop - 2 && y <= ay + b.BorderBottom + 2) {
          onMeasureClick(mi)
          return
        }
      }
    })
  }

  return (
    <div className="tt-score">
      <div ref={scrollRef} className="tt-score__scroll">
        <div ref={hostRef} onClick={handleClick} role="img" className="tt-score__host" aria-label="Partitur. Klicke auf einen Takt, um dorthin zu springen." />
      </div>
      {(rendering || error) && (
        <div className="tt-score__overlay">
          {error ? <p className="tt-score__error">Die Partitur konnte nicht dargestellt werden: {error}</p> : <span className="tt-spinner" aria-label="Partitur wird gesetzt" />}
        </div>
      )}
      <div className="tt-score__tools">
        <button className="tt-score__tool tt-score__tool--label" onClick={() => onShowAllParts(!showAllParts)} aria-pressed={showAllParts} title={showAllParts ? 'Nur meine Stimme zeigen' : 'Alle Stimmen zeigen'}>
          {showAllParts ? <Users size={16} /> : <User size={16} />}
          {showAllParts ? 'Alle' : 'Meine'}
        </button>
        <button className="tt-score__tool" onClick={() => onZoom(Math.max(0.45, +(zoom - 0.1).toFixed(2)))} aria-label="Partitur verkleinern">
          <Minus size={16} />
        </button>
        <button className="tt-score__tool" onClick={() => onZoom(Math.min(1.6, +(zoom + 0.1).toFixed(2)))} aria-label="Partitur vergrößern">
          <Plus size={16} />
        </button>
      </div>
    </div>
  )
}
