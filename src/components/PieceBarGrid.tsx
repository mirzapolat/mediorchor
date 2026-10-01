import { memo } from 'react';
import type { LoopRange } from '@/hooks/usePracticePlayer';
import type { PlayedBar } from '@/lib/pieceTimeline';
import { cn } from '@/lib/cn';

// Every bar in playback order (repeats appear again, marked with their pass).
// Tap starts playback there; shift-click on desktop picks a loop section.
export const PieceBarGrid = memo(
  ({
    bars,
    currentIndex,
    loop,
    pickFrom,
    onTap,
  }: {
    bars: PlayedBar[];
    currentIndex: number;
    loop: LoopRange | null;
    pickFrom: number | null;
    onTap: (index: number, shiftKey: boolean) => void;
  }) => (
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(3rem, 1fr))' }}
    >
      {bars.map((bar) => {
        const current = bar.index === currentIndex;
        const inLoop = loop != null && bar.index >= loop.from && bar.index <= loop.to;
        const picked = pickFrom === bar.index;
        return (
          <button
            key={bar.index}
            type="button"
            onClick={(e) => onTap(bar.index, e.shiftKey)}
            className={cn(
              'relative flex aspect-square items-center justify-center rounded-md border text-sm font-medium tabular-nums transition-colors duration-150',
              current
                ? 'border-accent bg-accent text-white'
                : picked
                  ? 'border-danger bg-danger text-white'
                  : inLoop
                    ? 'border-danger/40 bg-danger-soft text-danger-strong'
                    : 'border-border bg-surface text-text-secondary hover:border-black hover:text-text',
            )}
          >
            {bar.shown}
            {bar.occurrences > 1 && (
              <span
                className={cn(
                  'absolute right-1 top-0.5 text-[10px] font-semibold',
                  current || picked ? 'text-white/70' : 'text-text-tertiary',
                )}
              >
                {bar.occurrence}.
              </span>
            )}
          </button>
        );
      })}
    </div>
  ),
);
PieceBarGrid.displayName = 'PieceBarGrid';
