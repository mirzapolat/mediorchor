import { useRef, type PointerEvent } from 'react';
import { Pause, Play, Repeat, SkipBack, SkipForward, X } from 'lucide-react';
import { SpeedButton } from './PlayerControls';
import type { PracticePlayer } from '@/hooks/usePracticePlayer';
import { formatTime } from '@/lib/pieceTimeline';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';

// Loop-section picking: waiting for the first bar, or for the last one.
export type LoopPicking = null | { from: number | null };

const iconButton =
  'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-text ' +
  'hover:bg-surface/70 active:scale-95 transition-[transform,background-color] duration-150 disabled:opacity-40';

// Seek bar with the loop section and (when they fit) bar ticks drawn in. The
// thumb carries the current bar number, so no separate status line is needed.
// Tall invisible hit area so it is easy to grab with a thumb.
const SeekBar = ({ player }: { player: PracticePlayer }) => {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const { duration, time, bars, loop, currentBar } = player;
  const pct = (s: number) => (duration > 0 ? `${Math.min(100, (s / duration) * 100)}%` : '0%');

  const seekTo = (e: PointerEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return;
    const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    player.seek(f * duration);
  };

  return (
    <div
      ref={ref}
      role="slider"
      aria-label={t('seek')}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={currentBar ? `${formatTime(time)}, ${t('bar')} ${currentBar.shown}` : formatTime(time)}
      tabIndex={-1}
      className="relative h-7 cursor-pointer touch-none select-none"
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        seekTo(e);
      }}
      onPointerMove={(e) => dragging.current && seekTo(e)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-text-tertiary/25">
        {loop && bars[loop.from] && bars[loop.to] && (
          <div
            className="absolute inset-y-0 bg-danger/30"
            style={{ left: pct(bars[loop.from].start), right: `calc(100% - ${pct(bars[loop.to].end)})` }}
          />
        )}
        <div className="absolute inset-y-0 left-0 bg-black" style={{ width: pct(time) }} />
        {bars.length > 1 &&
          bars.length <= 160 &&
          bars.slice(1).map((b) => (
            <div
              key={b.index}
              className="absolute inset-y-0 w-px bg-surface/70"
              style={{ left: pct(b.start) }}
            />
          ))}
      </div>
      {currentBar ? (
        <div
          className="pointer-events-none absolute top-1/2 flex h-6 min-w-[1.75rem] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black px-1.5 text-xs font-semibold tabular-nums text-white shadow-md ring-2 ring-surface"
          // Keep the chip inside the track at both ends.
          style={{ left: `clamp(0.875rem, ${pct(time)}, calc(100% - 0.875rem))` }}
        >
          {currentBar.shown}
          {currentBar.occurrences > 1 && (
            <sup className="ml-px text-[9px] font-medium text-white/70">{currentBar.occurrence}.</sup>
          )}
        </div>
      ) : (
        <div
          className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-black shadow"
          style={{ left: pct(time) }}
        />
      )}
    </div>
  );
};

// Where the player sits:
// - sticky:   the page on phones, a bar across the bottom of the screen;
// - floating: the page on desktop, a box over the score column;
// - sheet:    fullscreen on phones, glass reaching the screen's bottom edge
//             (no gap below it), rounded on top;
// - dock:     fullscreen on desktop, a floating glass box.
export type PlayerPlacement = 'sticky' | 'floating' | 'sheet' | 'dock';

// The play button; while the heard voices load, a ring shows how far.
const PlayButton = ({ player }: { player: PracticePlayer }) => {
  const { t } = useI18n();
  const { playing, waiting, loadingProgress } = player;
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <button
      type="button"
      onClick={player.toggle}
      aria-label={playing || waiting ? t('pause') : t('play')}
      aria-busy={waiting || undefined}
      className="relative flex h-14 w-14 items-center justify-center rounded-full bg-black text-white shadow-lg transition-[transform,background-color] duration-150 hover:bg-black-hover active:scale-95"
    >
      {waiting && (
        <svg viewBox="0 0 56 56" className="absolute inset-0 -rotate-90" aria-hidden="true">
          <circle cx="28" cy="28" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
          <circle
            cx="28"
            cy="28"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - Math.max(0.04, loadingProgress))}
            className="transition-[stroke-dashoffset] duration-200"
          />
        </svg>
      )}
      {playing || waiting ? <Pause size={24} /> : <Play size={24} className="ml-1" />}
    </button>
  );
};

export const PiecePlayerBar = ({
  player,
  picking,
  onPickingChange,
  placement = 'sticky',
}: {
  player: PracticePlayer;
  picking: LoopPicking;
  onPickingChange: (picking: LoopPicking) => void;
  placement?: PlayerPlacement;
}) => {
  const { t } = useI18n();
  const { bars, currentBar, loop } = player;
  const hasBars = bars.length > 0;

  // Other plays of the same bar (repeats), to hop between them.
  const sameLabel = currentBar ? bars.filter((b) => b.label === currentBar.label) : [];

  const loopLabel =
    loop && bars[loop.from] && bars[loop.to]
      ? loop.from === loop.to
        ? bars[loop.from].shown
        : `${bars[loop.from].shown}–${bars[loop.to].shown}`
      : null;

  // Inline on the page (floating/sticky) the bar sits in a wrapper that also
  // holds the blurred band behind it — a sibling, not a child, of the glass,
  // since a backdrop filter inside another one would only blur the glass.
  const inline = placement === 'floating' || placement === 'sticky';
  const bar = (
    <div
      className={cn(
        'liquid-glass',
        inline ? 'relative' : 'z-30',
        placement === 'floating' && 'rounded-[28px] px-5 py-2.5',
        placement === 'sticky' &&
          'rounded-t-[28px] px-4 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2.5 sm:px-6 lg:px-8',
        placement === 'sheet' && 'rounded-b-none rounded-t-[28px] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3',
        placement === 'dock' && 'rounded-[28px] px-5 py-3',
      )}
    >
      {picking && (
        // Instruction while picking a loop, floating above the controls so
        // they don't grow.
        <div className="pointer-events-none absolute -top-11 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-danger px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg">
          {picking.from == null ? t('pickLoopStart') : t('pickLoopEnd')}
        </div>
      )}
      <div className={cn('space-y-1.5', (placement === 'sticky' || placement === 'sheet') && 'mx-auto max-w-3xl')}>
        {!player.supported && <p className="text-center text-sm text-danger">{t('playbackUnsupported')}</p>}
        {sameLabel.length > 1 && currentBar && (
          // The current bar is played more than once (repeat): hop between passes.
          <div className="flex items-center justify-center gap-1" aria-label={t('repeatPass')}>
            {sameLabel.map((b) => (
              <button
                key={b.index}
                type="button"
                onClick={() => player.playBar(b.index)}
                title={`${b.occurrence}. ${t('pass')}`}
                className={cn(
                  'h-7 min-w-[2rem] rounded-full px-2 text-xs font-medium tabular-nums transition-colors duration-150',
                  b.index === currentBar.index ? 'bg-black text-white' : 'bg-surface/50 text-text-secondary hover:text-text',
                )}
              >
                {b.occurrence}.
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="w-10 flex-shrink-0 text-xs tabular-nums text-text-secondary">{formatTime(player.time)}</span>
          <div className="min-w-0 flex-1">
            <SeekBar player={player} />
          </div>
          <span className="w-10 flex-shrink-0 text-right text-xs tabular-nums text-text-secondary">
            {formatTime(player.duration)}
          </span>
        </div>

        {/* Loop · back, play, forward · speed: the outer two share the room
            equally, so play stays in the middle. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
          <div className="flex justify-start">
            <button
              type="button"
              disabled={!hasBars}
              onClick={() => {
                if (loop) player.setLoop(null);
                else onPickingChange(picking ? null : { from: null });
              }}
              aria-pressed={Boolean(picking || loop)}
              aria-label={loop ? t('endLoop') : picking ? t('cancel') : t('loopSection')}
              title={loop ? t('endLoop') : t('loopSection')}
              className={cn(
                'flex h-10 flex-shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium tabular-nums transition-[transform,background-color] duration-150 active:scale-95 disabled:opacity-40',
                picking || loop ? 'bg-danger text-white hover:bg-danger-strong' : 'text-text-secondary hover:bg-surface/70 hover:text-text',
              )}
            >
              {picking ? <X size={16} /> : <Repeat size={16} />}
              {loopLabel ? (
                <>
                  <span>{loopLabel}</span>
                  <X size={14} className="-mr-1 opacity-80" />
                </>
              ) : (
                <span className="hidden sm:inline">{picking ? t('cancel') : t('loopShort')}</span>
              )}
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button type="button" onClick={player.prevBar} aria-label={hasBars ? t('previousBar') : t('back')} className={iconButton}>
              <SkipBack size={20} />
            </button>
            <PlayButton player={player} />
            <button type="button" onClick={player.nextBar} disabled={!hasBars} aria-label={t('nextBar')} className={iconButton}>
              <SkipForward size={20} />
            </button>
          </div>

          <div className="flex justify-end">
            <SpeedButton player={player} />
          </div>
        </div>
      </div>
    </div>
  );

  if (!inline) return bar;
  return (
    <div
      className={cn(
        'z-30',
        placement === 'floating' && 'sticky bottom-[calc(1.5rem+env(safe-area-inset-bottom))] -mx-4 mt-6',
        // The negative bottom margin cancels the page padding (PAGE_PADDING),
        // safe area included, so the bar reaches the screen's edge.
        placement === 'sticky' &&
          'sticky bottom-0 -mx-4 -mb-[calc(1rem+env(safe-area-inset-bottom))] mt-auto sm:-mx-6 sm:-mb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:-mx-8 lg:-mb-[calc(2rem+env(safe-area-inset-bottom))]',
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          'score-scrim score-scrim-bottom absolute -top-12',
          placement === 'floating'
            ? '-inset-x-4 -bottom-[calc(1.5rem+env(safe-area-inset-bottom))]'
            : 'inset-x-0 bottom-0',
        )}
      />
      {bar}
    </div>
  );
};
