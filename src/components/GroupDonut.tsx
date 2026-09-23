import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { FALLBACK_GROUP_COLOR, isHexColor } from '@/lib/groupColors';

export interface DonutSlice {
  id: string;
  label: string;
  value: number;
  color: string;
  // Muted slices (e.g. "No group") render as a neutral hatch, not a hue.
  muted?: boolean;
}

const SIZE = 232;
const CENTER = SIZE / 2;
const OUTER = 108;
const INNER = 76;
const HOVER_OFFSET = 5;

const polar = (radius: number, angle: number) => [
  CENTER + radius * Math.cos(angle),
  CENTER + radius * Math.sin(angle),
];

// Ring segment from a0 to a1 (radians, 0 = 3 o'clock, clockwise).
const arcPath = (a0: number, a1: number) => {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(OUTER, a0);
  const [x1, y1] = polar(OUTER, a1);
  const [x2, y2] = polar(INNER, a1);
  const [x3, y3] = polar(INNER, a0);
  return [
    `M ${x0} ${y0}`,
    `A ${OUTER} ${OUTER} 0 ${large} 1 ${x1} ${y1}`,
    `L ${x2} ${y2}`,
    `A ${INNER} ${INNER} 0 ${large} 0 ${x3} ${y3}`,
    'Z',
  ].join(' ');
};

// Donut of how members spread across groups, with a synced legend. Hovering a
// segment or a legend row highlights both and shows its numbers in the hole.
export const GroupDonut = ({
  slices,
  onSelect,
}: {
  slices: DonutSlice[];
  onSelect?: (slice: DonutSlice) => void;
}) => {
  const { t, lang } = useI18n();
  const [activeId, setActiveId] = useState<string | null>(null);

  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const visible = slices.filter((s) => s.value > 0);
  const percent = (value: number) =>
    total === 0
      ? '0 %'
      : new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', {
          style: 'percent',
          maximumFractionDigits: value / total < 0.1 ? 1 : 0,
        }).format(value / total);

  let angle = -Math.PI / 2; // start at 12 o'clock
  const segments = visible.map((slice) => {
    const sweep = (slice.value / total) * Math.PI * 2;
    const seg = { slice, a0: angle, a1: angle + sweep, mid: angle + sweep / 2 };
    angle += sweep;
    return seg;
  });

  const active = slices.find((s) => s.id === activeId) ?? null;
  const colorOf = (s: DonutSlice) => (isHexColor(s.color) ? s.color : FALLBACK_GROUP_COLOR);

  const summary = visible.map((s) => `${s.label}: ${s.value}`).join(', ');

  return (
    <div className="flex flex-col items-center">
      <div className="relative animate-[popin_420ms_cubic-bezier(0.2,0.8,0.2,1)]" style={{ width: SIZE, height: SIZE }}>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label={`${t('groupDistribution')}: ${summary}`}
          className="overflow-visible"
        >
          <defs>
            <pattern id="donut-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#ececec" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#d4d4d4" strokeWidth="2" />
            </pattern>
          </defs>

          {/* Track, visible when there is nothing to show and as a hairline base. */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={(OUTER + INNER) / 2}
            fill="none"
            stroke="#f0f0f0"
            strokeWidth={OUTER - INNER}
          />

          {segments.length === 1 ? (
            <circle
              cx={CENTER}
              cy={CENTER}
              r={(OUTER + INNER) / 2}
              fill="none"
              stroke={segments[0].slice.muted ? 'url(#donut-hatch)' : colorOf(segments[0].slice)}
              strokeWidth={OUTER - INNER}
              onMouseEnter={() => setActiveId(segments[0].slice.id)}
              onMouseLeave={() => setActiveId(null)}
              onClick={() => !segments[0].slice.muted && onSelect?.(segments[0].slice)}
              className={cn(onSelect && !segments[0].slice.muted && 'cursor-pointer')}
            />
          ) : (
            segments.map(({ slice, a0, a1, mid }) => {
              const isActive = slice.id === activeId;
              const dimmed = activeId !== null && !isActive;
              const dx = isActive ? Math.cos(mid) * HOVER_OFFSET : 0;
              const dy = isActive ? Math.sin(mid) * HOVER_OFFSET : 0;
              return (
                <path
                  key={slice.id}
                  d={arcPath(a0, a1)}
                  fill={slice.muted ? 'url(#donut-hatch)' : colorOf(slice)}
                  // 2px surface-colored gap between neighbouring segments.
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  style={{
                    transform: `translate(${dx}px, ${dy}px)`,
                    opacity: dimmed ? 0.3 : 1,
                    transition: 'transform 180ms ease, opacity 180ms ease',
                  }}
                  onMouseEnter={() => setActiveId(slice.id)}
                  onMouseLeave={() => setActiveId(null)}
                  onClick={() => !slice.muted && onSelect?.(slice)}
                  className={cn(onSelect && !slice.muted && 'cursor-pointer')}
                />
              );
            })
          )}
        </svg>

        {/* Center readout: total by default, the hovered slice otherwise. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {active ? (
            <>
              <span className="max-w-[128px] truncate text-xs font-medium text-text-secondary">
                {active.label}
              </span>
              <span className="text-[34px] font-semibold leading-tight tabular-nums text-text">
                {active.value}
              </span>
              <span className="text-xs tabular-nums text-text-tertiary">{percent(active.value)}</span>
            </>
          ) : (
            <>
              <span className="text-[40px] font-semibold leading-none tabular-nums text-text">{total}</span>
              <span className="mt-1.5 text-xs font-medium uppercase tracking-wide text-text-tertiary">
                {t('groupDonutTotal')}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Legend doubles as the table view: every slice with count and share. */}
      <ul className="mt-6 w-full divide-y divide-border">
        {slices.map((slice) => {
          const isActive = slice.id === activeId;
          const clickable = Boolean(onSelect) && !slice.muted;
          return (
            <li key={slice.id}>
              <button
                type="button"
                // aria-disabled (not disabled) so hover still highlights the slice.
                aria-disabled={!clickable}
                onMouseEnter={() => setActiveId(slice.id)}
                onMouseLeave={() => setActiveId(null)}
                onFocus={() => setActiveId(slice.id)}
                onBlur={() => setActiveId(null)}
                onClick={() => clickable && onSelect?.(slice)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors duration-150',
                  !clickable && 'cursor-default',
                  isActive && 'bg-[#f5f5f5]',
                  slice.value === 0 && 'opacity-50',
                )}
              >
                <span
                  className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                  style={
                    slice.muted
                      ? { background: 'repeating-linear-gradient(45deg, #d4d4d4 0 2px, #ececec 2px 4px)' }
                      : { backgroundColor: colorOf(slice) }
                  }
                />
                <span className={cn('min-w-0 flex-1 truncate', slice.muted ? 'text-text-secondary' : 'text-text')}>
                  {slice.label}
                </span>
                <span className="tabular-nums font-medium text-text">{slice.value}</span>
                <span className="w-12 text-right text-xs tabular-nums text-text-tertiary">
                  {percent(slice.value)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
