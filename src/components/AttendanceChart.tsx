import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  // Muted series (e.g. "No group") render as a neutral hatch, not a hue.
  muted?: boolean;
}

export interface ChartColumn {
  id: string;
  name: string;
  date: string;
  // Present members per series key.
  present: Record<string, number>;
  excused: number;
  // Active members the column is measured against.
  roster: number;
}

const PLOT_HEIGHT = 260;
const HATCH = 'repeating-linear-gradient(45deg, #cfcfcf 0 2px, #ececec 2px 5px)';
const TRACK = '#f2f2f2';

// Picks a round step so the y-axis gets 3–5 gridlines.
const niceScale = (max: number) => {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500];
  const step = steps.find((s) => max / s <= 5) ?? Math.ceil(max / 5);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
};

const seriesFill = (s: ChartSeries): CSSProperties =>
  s.muted ? { background: HATCH } : { backgroundColor: s.color };

const Swatch = ({ style, className }: { style?: CSSProperties; className?: string }) => (
  <span className={cn('h-2.5 w-2.5 flex-shrink-0 rounded-[3px]', className)} style={style} />
);

const ExcusedSwatch = () => (
  <Swatch className="border-[1.5px] border-dashed border-[#a3a3a3] bg-white" />
);

// Stacked column chart: one column per rehearsal, present members stacked by
// group in the groups' own colours, then the excused, on a light track that
// reaches up to the number of active members.
export const AttendanceChart = ({
  columns,
  series,
}: {
  columns: ChartColumn[];
  series: ChartSeries[];
}) => {
  const { t, lang } = useI18n();
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  const locale = lang === 'de' ? 'de-DE' : 'en-US';
  const shortDate = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }),
    [locale],
  );
  const longDate = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'short', dateStyle: 'medium' } as Intl.DateTimeFormatOptions),
    [locale],
  );
  const percent = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }),
    [locale],
  );

  const totals = columns.map((c) => {
    const present = series.reduce((sum, s) => sum + (c.present[s.key] ?? 0), 0);
    return { present, height: Math.max(c.roster, present + c.excused) };
  });
  const { top, ticks } = niceScale(Math.max(1, ...totals.map((x) => x.height)));
  const pct = (v: number) => `${(v / top) * 100}%`;

  // Series with no attendance at all stay out of the legend.
  const visibleSeries = series.filter((s) => columns.some((c) => (c.present[s.key] ?? 0) > 0));

  const hovered = columns.find((c) => c.id === hoverId) ?? null;
  const hoveredTotal = hovered ? totals[columns.indexOf(hovered)] : null;

  // Label every n-th date so they never collide.
  const labelEvery = Math.max(1, Math.ceil(columns.length / 24));

  return (
    <div>
      {/* Legend: hovering an entry highlights that group across all columns. */}
      <ul className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-secondary">
        {visibleSeries.map((s) => (
          <li
            key={s.key}
            onMouseEnter={() => setFocusKey(s.key)}
            onMouseLeave={() => setFocusKey(null)}
            className={cn(
              'inline-flex cursor-default items-center gap-1.5 transition-opacity duration-150',
              focusKey && focusKey !== s.key && 'opacity-40',
            )}
          >
            <Swatch style={seriesFill(s)} />
            {s.label}
          </li>
        ))}
        <li className={cn('inline-flex items-center gap-1.5 transition-opacity', focusKey && 'opacity-40')}>
          <ExcusedSwatch />
          {t('excused')}
        </li>
        <li className={cn('inline-flex items-center gap-1.5 transition-opacity', focusKey && 'opacity-40')}>
          <Swatch style={{ backgroundColor: TRACK }} className="border border-border" />
          {t('notAttended')}
        </li>
      </ul>

      <div className="flex">
        {/* Y-axis labels */}
        <div className="relative mr-2 mt-2 w-7 flex-shrink-0" style={{ height: PLOT_HEIGHT }}>
          {ticks.map((v) => (
            <span
              key={v}
              className="absolute right-0 -translate-y-1/2 text-[11px] tabular-nums text-text-tertiary"
              style={{ bottom: pct(v) }}
            >
              {v}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto pb-1 pt-2">
          <div className="relative" style={{ minWidth: columns.length * 30 }}>
            {/* Gridlines */}
            <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: PLOT_HEIGHT }}>
              {ticks.map((v) => (
                <div
                  key={v}
                  className={cn('absolute inset-x-0 border-t', v === 0 ? 'border-[#d4d4d4]' : 'border-[#f0f0f0]')}
                  style={{ bottom: pct(v) }}
                />
              ))}
            </div>

            <div
              className="relative flex gap-1.5"
              onMouseLeave={() => {
                setHoverId(null);
                setPointer(null);
              }}
            >
              {columns.map((c, i) => {
                const isHover = c.id === hoverId;
                const dimmed = hoverId !== null && !isHover;
                const stack = [
                  ...series.map((s) => ({
                    key: s.key,
                    value: c.present[s.key] ?? 0,
                    style: seriesFill(s),
                    className: '',
                  })),
                  {
                    key: '__excused',
                    value: c.excused,
                    style: {},
                    className: 'border-[1.5px] border-dashed border-[#a3a3a3] bg-white',
                  },
                ].filter((seg) => seg.value > 0);

                return (
                  <div
                    key={c.id}
                    className="flex min-w-[24px] max-w-[56px] flex-1 flex-col items-center"
                    onMouseEnter={() => setHoverId(c.id)}
                    onMouseMove={(e) => setPointer({ x: e.clientX, y: e.clientY })}
                  >
                    {/* Track up to the roster, with the stack anchored to the baseline */}
                    <div className="relative w-full" style={{ height: PLOT_HEIGHT }}>
                      <div
                        className={cn(
                          'absolute inset-x-0 bottom-0 rounded-t-[4px] transition-colors duration-150',
                          isHover && 'ring-1 ring-[#d4d4d4]',
                        )}
                        style={{ height: pct(totals[i].height), backgroundColor: TRACK }}
                      />
                      <div
                        className="absolute inset-x-0 bottom-0 flex origin-bottom animate-[growup_520ms_cubic-bezier(0.2,0.8,0.2,1)_both] flex-col-reverse gap-[2px]"
                        style={{
                          height: pct(totals[i].present + c.excused),
                          animationDelay: `${Math.min(i * 18, 360)}ms`,
                          opacity: dimmed ? 0.45 : 1,
                          transition: 'opacity 150ms ease',
                        }}
                      >
                        {stack.map((seg, j) => (
                          <div
                            key={seg.key}
                            className={cn(
                              'min-h-[2px] transition-opacity duration-150',
                              j === stack.length - 1 && 'rounded-t-[4px]',
                              seg.className,
                              focusKey && focusKey !== seg.key && 'opacity-25',
                            )}
                            style={{ ...seg.style, flexGrow: seg.value, flexBasis: 0 }}
                          />
                        ))}
                      </div>
                    </div>
                    <span
                      className={cn(
                        'mt-2 h-4 whitespace-nowrap text-[11px] tabular-nums transition-colors',
                        isHover ? 'font-medium text-text' : 'text-text-tertiary',
                      )}
                    >
                      {i % labelEvery === 0 || isHover ? shortDate.format(new Date(c.date)) : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {hovered && hoveredTotal && pointer && (
        <Tooltip x={pointer.x} y={pointer.y}>
          <p className="font-semibold text-text">{hovered.name}</p>
          <p className="text-xs text-text-tertiary">{longDate.format(new Date(hovered.date))}</p>
          <ul className="mt-2.5 space-y-1">
            {series
              .filter((s) => (hovered.present[s.key] ?? 0) > 0)
              .map((s) => (
                <li key={s.key} className="flex items-center gap-2">
                  <Swatch style={seriesFill(s)} />
                  <span className="flex-1 truncate text-text-secondary">{s.label}</span>
                  <span className="font-medium tabular-nums text-text">{hovered.present[s.key]}</span>
                </li>
              ))}
            {hovered.excused > 0 && (
              <li className="flex items-center gap-2">
                <ExcusedSwatch />
                <span className="flex-1 text-text-secondary">{t('excused')}</span>
                <span className="font-medium tabular-nums text-text">{hovered.excused}</span>
              </li>
            )}
          </ul>
          <div className="mt-2.5 flex items-baseline justify-between gap-4 border-t border-border pt-2">
            <span className="text-text-secondary">
              {t('presentOfMembers')
                .replace('{n}', String(hoveredTotal.present))
                .replace('{total}', String(hovered.roster))}
            </span>
            <span className="font-semibold tabular-nums text-text">
              {hovered.roster ? percent.format(hoveredTotal.present / hovered.roster) : '—'}
            </span>
          </div>
        </Tooltip>
      )}
    </div>
  );
};

// Follows the pointer and flips to the other side near the viewport edge.
const Tooltip = ({ x, y, children }: { x: number; y: number; children: ReactNode }) => {
  const width = 240;
  const flip = x + width + 24 > window.innerWidth;
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 rounded-lg border border-border bg-surface px-3.5 py-3 text-sm shadow-[0_8px_24px_rgba(0,0,0,0.08)] animate-[fadein_120ms_ease]"
      style={{
        width,
        left: flip ? x - width - 16 : x + 16,
        top: Math.max(8, Math.min(y - 24, window.innerHeight - 280)),
      }}
    >
      {children}
    </div>
  );
};
