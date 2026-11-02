import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

// Slowly flowing line strands behind the sign-in screens. Two mirrored sets of
// curves in the text color (so they follow light/dark mode), drawn faintly and
// animated with CSS only (see .floating-paths in index.css).
// Every animated strand is repainted each frame, so keep the count low: 14 per
// side, spaced every other step of the original 28 so the spread stays the same.
const STRANDS = 14;

const strands = (position: 1 | -1) =>
  Array.from({ length: STRANDS }, (_, n) => {
    const i = n * 2;
    const x = i * 5 * position;
    return {
      id: `${position}-${i}`,
      d: `M-${380 - x} -${189 + i * 6}C-${380 - x} -${189 + i * 6} -${312 - x} ${216 - i * 6} ${152 - x} ${
        343 - i * 6
      }C${616 - x} ${470 - i * 6} ${684 - x} ${875 - i * 6} ${684 - x} ${875 - i * 6}`,
      width: 0.4 + i * 0.03,
      opacity: 0.025 + i * 0.004,
      // Deterministic spread of speeds and phases, so strands don't move in lockstep.
      duration: 22 + ((i * 7) % 12),
      delay: -((i * 13) % 30),
    };
  });

const PATHS = [...strands(1), ...strands(-1)];

const strandId = (id: string) => `fp-strand${id}`;

// A few notes riding along the strands, as a quiet detail: the head sits on
// the line and the note stays upright. Drawn around the centre of the head
// (stem up, to the right), in viewBox units.
const HEAD = <ellipse cx="0" cy="0" rx="3.3" ry="2.35" transform="rotate(-22)" />;
const stem = (top: number) => <rect x="2.5" y={top} width="0.85" height={-top - 0.4} rx="0.3" />;
const flag = (top: number) => <path d={`M3.35 ${top}c0.3 2.9 4.1 4.3 3.4 8.4c-0.2-2.2-1.8-3.6-3.4-4.6z`} />;

const GLYPHS = {
  quarter: (
    <>
      {HEAD}
      {stem(-14)}
    </>
  ),
  eighth: (
    <>
      {HEAD}
      {stem(-14)}
      {flag(-14)}
    </>
  ),
  sixteenth: (
    <>
      {HEAD}
      {stem(-14)}
      {flag(-14)}
      {flag(-10.6)}
    </>
  ),
  // Two eighths under one beam, the second a step higher.
  beamed: (
    <>
      {HEAD}
      {stem(-14)}
      <g transform="translate(9 -2.6)">
        {HEAD}
        {stem(-13.9)}
      </g>
      <path d="M2.5 -14L12.35 -16.6L12.35 -14.3L2.5 -11.7Z" />
    </>
  ),
};

type Glyph = keyof typeof GLYPHS;

// Which strand a note rides and where on its moving dash (0 = the dash's
// start, the dash is 0.6 of the strand long, see index.css). A note keeps the
// dash's own pace and phase, so it always sits on the drawn line and comes
// into view as its dash flows through. Only the brighter (inner) strands.
const NOTES: Array<{ strand: string; glyph: Glyph; at: number }> = [
  { strand: '1-26', glyph: 'eighth', at: 0.18 },
  { strand: '1-26', glyph: 'quarter', at: 0.44 },
  { strand: '1-22', glyph: 'beamed', at: 0.3 },
  { strand: '1-18', glyph: 'sixteenth', at: 0.22 },
  { strand: '1-14', glyph: 'quarter', at: 0.4 },
  { strand: '-1-26', glyph: 'beamed', at: 0.26 },
  { strand: '-1-24', glyph: 'eighth', at: 0.14 },
  { strand: '-1-24', glyph: 'sixteenth', at: 0.46 },
  { strand: '-1-20', glyph: 'quarter', at: 0.32 },
  { strand: '-1-16', glyph: 'eighth', at: 0.24 },
];

const BY_ID = new Map(PATHS.map((p) => [p.id, p]));

// The dash starts at ((t - delay) / duration) of the strand; a note at `at`
// into it, moving at the same pace, starts its pass that much earlier.
const ride = (strand: string, at: number) => {
  const p = BY_ID.get(strand)!;
  return { duration: `${p.duration}s`, begin: `${p.delay - at * p.duration}s` };
};

// Built once at module level: the element never changes, so React skips it when
// the page above re-renders (e.g. on every keystroke in the login form).
const SVG = (
  <svg
    className="floating-paths pointer-events-none absolute inset-0 -z-10 h-full w-full text-text animate-[fadein_1.2s_ease-out]"
    viewBox="0 0 696 316"
    preserveAspectRatio="xMidYMid slice"
    fill="none"
    aria-hidden="true"
  >
    <defs>
      {Object.entries(GLYPHS).map(([name, shape]) => (
        <g key={name} id={`fp-note-${name}`}>
          {shape}
        </g>
      ))}
    </defs>
    {PATHS.map((p) => (
      <path
        key={p.id}
        id={strandId(p.id)}
        d={p.d}
        pathLength={1}
        stroke="currentColor"
        strokeWidth={p.width}
        strokeOpacity={p.opacity}
        style={{ animationDuration: `${p.duration}s`, animationDelay: `${p.delay}s` }}
      />
    ))}
    {/* Each note rides its strand's dash (SVG animateMotion). */}
    <g className="fp-notes" fill="currentColor" fillOpacity="0.18">
      {NOTES.map((n) => {
        const { duration, begin } = ride(n.strand, n.at);
        return (
          <g key={`${n.strand}-${n.at}`}>
            <g transform="scale(0.62)">
              <use href={`#fp-note-${n.glyph}`} />
            </g>
            <animateMotion dur={duration} begin={begin} repeatCount="indefinite">
              <mpath href={`#${strandId(n.strand)}`} />
            </animateMotion>
          </g>
        );
      })}
    </g>
  </svg>
);

export const FloatingPaths = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('relative isolate overflow-hidden', className)}>
    {SVG}
    {children}
  </div>
);
