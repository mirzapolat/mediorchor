import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

// Slowly flowing line strands behind the sign-in screens. Two mirrored sets of
// curves in the text color (so they follow light/dark mode), drawn faintly and
// animated with CSS only (see .floating-paths in index.css).
const STRANDS = 28;

const strands = (position: 1 | -1) =>
  Array.from({ length: STRANDS }, (_, i) => {
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

export const FloatingPaths = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('relative isolate overflow-hidden', className)}>
    <svg
      className="floating-paths pointer-events-none absolute inset-0 -z-10 h-full w-full text-text animate-[fadein_1.2s_ease-out]"
      viewBox="0 0 696 316"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      aria-hidden="true"
    >
      {PATHS.map((p) => (
        <path
          key={p.id}
          d={p.d}
          pathLength={1}
          stroke="currentColor"
          strokeWidth={p.width}
          strokeOpacity={p.opacity}
          style={{ animationDuration: `${p.duration}s`, animationDelay: `${p.delay}s` }}
        />
      ))}
    </svg>
    {children}
  </div>
);
