import { useRef, type PointerEvent } from 'react';
import { LocateFixed, Pause, Play, Repeat, SkipBack, SkipForward, X } from 'lucide-react';
import { PLAYBACK_RATES, type PracticePlayer } from '@/hooks/usePracticePlayer';
import { formatTime } from '@/lib/pieceTimeline';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import type { PieceFile } from '@/types';

// Loop-section picking: waiting for the first bar, or for the last one.
export type LoopPicking = null | { from: number | null };

const iconButton =
  'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-text-secondary sm:h-11 sm:w-11 ' +
  'hover:bg-surface-hover hover:text-text transition-colors duration-150 disabled:opacity-40';

// Lucide has no metronome; drawn in the same stroke style.
const MetronomeIcon = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9.5 3h5l4.5 18H5L9.5 3z" />
    <path d="M7 15h10" />
    <path d="M12 15l5-9" />
  </svg>
);

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
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-surface-hover">
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

export const PiecePlayerBar = ({
  player,
  tracks,
  picking,
  onPickingChange,
  floating = false,
  follow,
}: {
  player: PracticePlayer;
  tracks: PieceFile[];
  picking: LoopPicking;
  onPickingChange: (picking: LoopPicking) => void;
  // Desktop: a rounded box hovering over the score column. Otherwise a bar
  // across the bottom of the screen.
  floating?: boolean;
  // Toggle for the score scrolling along; hidden when there is nothing to follow.
  follow?: { on: boolean; onChange: (on: boolean) => void };
}) => {
  const { t } = useI18n();
  const { track, bars, currentBar, loop, playing, metronome } = player;
  const hasBars = bars.length > 0;

  // Other plays of the same bar (repeats), to hop between them.
  const sameLabel = currentBar ? bars.filter((b) => b.label === currentBar.label) : [];

  const loopLabel =
    loop && bars[loop.from] && bars[loop.to]
      ? loop.from === loop.to
        ? bars[loop.from].shown
        : `${bars[loop.from].shown}–${bars[loop.to].shown}`
      : null;
  const showTopRow = tracks.length > 1 || (sameLabel.length > 1 && currentBar);

  return (
    <div
      className={cn(
        // Frosted glass: the score shows through, blurred.
        'sticky z-30 bg-surface/60 backdrop-blur-xl backdrop-saturate-150',
        floating
          ? // A little wider than the score column below it.
            'bottom-6 -mx-4 mt-6 rounded-2xl border border-border/60 px-5 py-2.5 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.35)]'
          : 'bottom-0 -mx-4 -mb-4 mt-auto border-t border-border/60 px-4 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2 sm:-mx-6 sm:-mb-6 sm:px-6 lg:-mx-8 lg:-mb-8 lg:px-8',
      )}
    >
      {picking && (
        // Instruction while picking a loop, floating above the controls so
        // they don't grow.
        <div className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-danger px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg">
          {picking.from == null ? t('pickLoopStart') : t('pickLoopEnd')}
        </div>
      )}
      <div className={cn('space-y-1.5', !floating && 'mx-auto max-w-3xl')}>
        {showTopRow && (
          // Voices centred; the repeat-pass switch (when shown) sits right
          // without pushing them off centre.
          <div className="grid grid-cols-[1fr_minmax(0,auto)_1fr] items-center gap-2">
            <span />
            <div
              role="tablist"
              aria-label={t('voices')}
              className="-mx-1 min-w-0 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]"
            >
              <div className="mx-auto flex w-max gap-1.5">
                {tracks.length > 1 &&
                  tracks.map((tr) => (
                    <button
                      key={tr.id}
                      type="button"
                      role="tab"
                      aria-selected={tr.id === track?.id}
                      onClick={() => player.selectTrack(tr.id)}
                      className={cn(
                        'h-8 flex-shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors duration-150',
                        tr.id === track?.id
                          ? 'border-black bg-black text-white'
                          : 'border-border bg-surface/60 text-text-secondary hover:text-text',
                      )}
                    >
                      {tr.title || tr.file_name}
                    </button>
                  ))}
              </div>
            </div>
            {sameLabel.length > 1 && currentBar ? (
              // The current bar is played more than once (repeat): hop between passes.
              <div className="flex items-center justify-end gap-1" aria-label={t('repeatPass')}>
                {sameLabel.map((b) => (
                  <button
                    key={b.index}
                    type="button"
                    onClick={() => player.playBar(b.index)}
                    title={`${b.occurrence}. ${t('pass')}`}
                    className={cn(
                      'h-7 min-w-[2rem] rounded-full border px-2 text-xs font-medium tabular-nums transition-colors duration-150',
                      b.index === currentBar.index
                        ? 'border-black bg-black text-white'
                        : 'border-border text-text-secondary hover:text-text',
                    )}
                  >
                    {b.occurrence}.
                  </button>
                ))}
              </div>
            ) : (
              <span />
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="w-10 flex-shrink-0 text-xs tabular-nums text-text-secondary">
            {formatTime(player.time)}
          </span>
          <div className="min-w-0 flex-1">
            <SeekBar player={player} />
          </div>
          <span className="w-10 flex-shrink-0 text-right text-xs tabular-nums text-text-secondary">
            {formatTime(player.duration)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-1">
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
              'flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium tabular-nums transition-colors duration-150 disabled:opacity-40',
              picking || loop
                ? 'bg-danger text-white hover:bg-danger-strong'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text',
            )}
          >
            {picking ? <X size={16} /> : <Repeat size={16} />}
            {loopLabel ? (
              <>
                <span>{loopLabel}</span>
                <X size={14} className="-mr-1 opacity-80" />
              </>
            ) : (
              <span className="hidden min-[440px]:inline">{picking ? t('cancel') : t('loopShort')}</span>
            )}
          </button>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={player.prevBar}
              aria-label={hasBars ? t('previousBar') : t('back')}
              className={iconButton}
            >
              <SkipBack size={20} />
            </button>
            <button
              type="button"
              onClick={player.toggle}
              aria-label={playing ? t('pause') : t('play')}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-black text-white shadow-md transition-colors duration-150 hover:bg-black-hover"
            >
              {playing ? <Pause size={24} /> : <Play size={24} className="ml-1" />}
            </button>
            <button
              type="button"
              onClick={player.nextBar}
              disabled={!hasBars}
              aria-label={t('nextBar')}
              className={iconButton}
            >
              <SkipForward size={20} />
            </button>
          </div>

          <div className="flex flex-shrink-0 items-center gap-1">
            {follow && (
              <button
                type="button"
                onClick={() => follow.onChange(!follow.on)}
                aria-pressed={follow.on}
                aria-label={t('follow')}
                title={t('followHint')}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-150',
                  follow.on
                    ? 'bg-black text-white hover:bg-black-hover'
                    : 'text-text-secondary hover:bg-surface-hover hover:text-text',
                )}
              >
                <LocateFixed size={16} />
              </button>
            )}
            {metronome.available && (
              <button
                type="button"
                onClick={() => metronome.setOn(!metronome.on)}
                aria-pressed={metronome.on}
                aria-label={t('metronome')}
                title={t('metronome')}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-150',
                  metronome.on
                    ? 'bg-black text-white hover:bg-black-hover'
                    : 'text-text-secondary hover:bg-surface-hover hover:text-text',
                )}
              >
                <MetronomeIcon />
              </button>
            )}
            {/* The value is drawn by a pill (selects ignore text alignment and
                padding in some browsers); the native select lies invisibly on
                top, so the system picker still opens. */}
            <label
              title={t('playbackSpeed')}
              className="relative flex h-9 min-w-[3.75rem] flex-shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-full border border-border bg-surface/60 px-3 text-sm font-medium tabular-nums text-text-secondary transition-colors duration-150 focus-within:border-black hover:text-text"
            >
              {player.rate}×
              <select
                value={player.rate}
                onChange={(e) => player.setRate(Number(e.target.value))}
                aria-label={t('playbackSpeed')}
                className="absolute inset-0 cursor-pointer appearance-none opacity-0"
              >
                {PLAYBACK_RATES.map((r) => (
                  <option key={r} value={r}>
                    {r}×
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
