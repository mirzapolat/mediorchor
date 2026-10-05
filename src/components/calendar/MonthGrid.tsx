import { useLayoutEffect, useRef, useState, type TouchEvent, type WheelEvent } from 'react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { localToday } from '@/lib/eventTiming';
import { fromISODate, monthGrid, monthKey, weekdayNames, type CalendarEntry } from '@/lib/calendar';

const MAX_CHIPS = 3;
// Fill mode (px): a cell's padding plus its day number row, one chip with
// its gap, and the "+n more" line.
const CELL_CHROME = 40;
const CHIP_HEIGHT = 26;
const MORE_LINE = 22;

// Notion-style month view: six Monday-first weeks, each day listing its
// entries as coloured chips (dots on phones). Clicking a day opens it.
// Horizontal swipes / trackpad scrolls page through the months. With `fill`
// the weeks stretch to the parent's height and each day shows as many chips
// as fit.
export const MonthGrid = ({
  fill = false,
  month,
  entriesByDate,
  colorOf,
  onOpenDay,
  onPage,
}: {
  fill?: boolean;
  month: string; // any date in the shown month
  entriesByDate: Map<string, CalendarEntry[]>;
  colorOf: (entry: CalendarEntry) => string;
  onOpenDay: (iso: string) => void;
  onPage: (offset: number) => void;
}) => {
  const { t, lang } = useI18n();
  const today = localToday();
  const days = monthGrid(month);
  const shownMonth = monthKey(month);
  const dateLocale = lang === 'de' ? 'de-DE' : 'en-GB';

  const weeks = useRef<HTMLDivElement>(null);
  // How many chips fit when all are shown, and when a "+n more" line follows.
  const [fit, setFit] = useState({ all: MAX_CHIPS, withMore: MAX_CHIPS });
  useLayoutEffect(() => {
    const el = weeks.current;
    if (!fill || !el) {
      setFit({ all: MAX_CHIPS, withMore: MAX_CHIPS });
      return;
    }
    const observer = new ResizeObserver(() => {
      const room = el.clientHeight / 6 - CELL_CHROME;
      setFit({
        all: Math.max(1, Math.floor(room / CHIP_HEIGHT)),
        withMore: Math.max(1, Math.floor((room - MORE_LINE) / CHIP_HEIGHT)),
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fill]);

  // Swipe (touch) and sideways trackpad scrolling page months; a cooldown
  // keeps one gesture from skipping several months.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const wheel = useRef({ sum: 0, lockedUntil: 0 });
  const onTouchStart = (e: TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) onPage(dx < 0 ? 1 : -1);
  };
  const onWheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const now = Date.now();
    if (now < wheel.current.lockedUntil) return;
    wheel.current.sum += e.deltaX;
    if (Math.abs(wheel.current.sum) > 80) {
      onPage(wheel.current.sum > 0 ? 1 : -1);
      wheel.current = { sum: 0, lockedUntil: now + 600 };
    }
  };

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onWheel={onWheel}
      className={cn('select-none', fill && 'flex min-h-0 flex-1 flex-col')}
    >
      <div className="grid grid-cols-7 border-b border-border">
        {weekdayNames(lang).map((name, i) => (
          <div
            key={i}
            className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wide text-text-tertiary sm:text-left"
          >
            {name}
          </div>
        ))}
      </div>
      <div ref={weeks} className={cn('grid grid-cols-7', fill && 'min-h-0 flex-1 grid-rows-6')}>
        {days.map((iso, i) => {
          const entries = entriesByDate.get(iso) ?? [];
          const inMonth = monthKey(iso) === shownMonth;
          const isToday = iso === today;
          const weekend = i % 7 >= 5;
          const limit = entries.length <= fit.all ? entries.length : fit.withMore;
          const hidden = entries.length - limit;
          const date = fromISODate(iso);
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onOpenDay(iso)}
              aria-label={`${date.toLocaleDateString(dateLocale, { weekday: 'long', day: 'numeric', month: 'long' })}${
                entries.length ? ` · ${entries.length} ${t('calendarEntries')}` : ''
              }`}
              className={cn(
                'flex flex-col items-stretch gap-1 overflow-hidden border-border p-1 text-left transition-colors duration-100 sm:p-1.5',
                fill ? 'min-h-0' : 'min-h-[3.75rem] sm:min-h-[7.25rem]',
                i % 7 !== 6 && 'border-r',
                i < 35 && 'border-b',
                weekend || !inMonth ? 'bg-surface-subtle' : 'bg-surface',
                'hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black',
              )}
            >
              <span className="flex justify-center sm:justify-start">
                <span
                  className={cn(
                    'flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs tabular-nums sm:text-[13px]',
                    isToday ? 'bg-accent font-semibold text-white' : inMonth ? 'font-medium text-text' : 'text-text-tertiary',
                  )}
                >
                  {date.getDate()}
                  {/* The month's name on its first day, like Notion. */}
                  {iso.endsWith('-01') ? (
                    <span className={cn('ml-1 hidden font-normal sm:inline', !isToday && 'text-text-tertiary')}>
                      {date.toLocaleDateString(dateLocale, { month: 'short' })}
                    </span>
                  ) : null}
                </span>
              </span>

              {/* Phones: one dot per entry (up to three). */}
              {entries.length > 0 && (
                <span className="flex justify-center gap-0.5 sm:hidden">
                  {entries.slice(0, MAX_CHIPS).map((entry) => (
                    <span key={entry.key} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colorOf(entry) }} />
                  ))}
                </span>
              )}

              <span className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                {entries.slice(0, limit).map((entry) => (
                  <EntryChip key={entry.key} entry={entry} color={colorOf(entry)} muted={!inMonth} />
                ))}
                {hidden > 0 && (
                  <span className="px-1.5 text-xs font-medium text-text-secondary">
                    +{hidden} {t('calendarMore')}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const EntryChip = ({ entry, color, muted }: { entry: CalendarEntry; color: string; muted: boolean }) => (
  <span
    className={cn('flex min-w-0 items-center gap-1.5 rounded-[5px] py-0.5 pl-2 pr-1 text-xs leading-5', muted && 'opacity-60')}
    // A light wash of the calendar's colour with a solid edge on the left.
    style={{ backgroundColor: `${color}1f`, boxShadow: `inset 2px 0 0 ${color}` }}
  >
    {entry.start ? <span className="flex-shrink-0 tabular-nums text-text-secondary">{entry.start}</span> : null}
    <span className="min-w-0 truncate font-medium text-text">{entry.name}</span>
  </span>
);
