import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { localToday } from '@/lib/eventTiming';
import {
  addDays,
  addMonths,
  formatDay,
  formatMonth,
  fromISODate,
  monthGrid,
  monthKey,
  monthNames,
  weekdayNames,
} from '@/lib/calendar';

interface DatePickerProps {
  value: string | null; // YYYY-MM-DD
  onChange: (iso: string) => void;
  // 'field' looks like a form input (with label); 'button' is a compact
  // header button (e.g. "jump to date").
  variant?: 'field' | 'button';
  label?: string;
  buttonLabel?: string;
  placeholder?: string;
  align?: 'left' | 'right';
  id?: string;
}

// A popover month calendar: arrows page months, the title switches to a month
// and year overview, the keyboard moves the focused day (arrows, PageUp/Down
// for months, Home/End within the week, Enter to pick, Escape to close).
export const DatePicker = ({
  value,
  onChange,
  variant = 'field',
  label,
  buttonLabel,
  placeholder,
  align = 'left',
  id,
}: DatePickerProps) => {
  const { t, lang } = useI18n();
  const autoId = useId();
  const fieldId = id ?? autoId;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'days' | 'months'>('days');
  const [cursor, setCursor] = useState(value ?? localToday());
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // The popover is portalled with fixed coordinates, so a scrolling container
  // (e.g. a modal body) can't clip it.
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const today = localToday();

  // Opening starts at the picked day (or today).
  useEffect(() => {
    if (open) {
      setCursor(value ?? localToday());
      setView('days');
    }
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Below the trigger (above it when there's no room), kept inside the
  // viewport; follows scrolling and resizing.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const popover = popoverRef.current;
      if (!trigger) return;
      const width = popover?.offsetWidth ?? 296;
      const height = popover?.offsetHeight ?? 360;
      const margin = 8;
      let left = align === 'right' ? trigger.right - width : trigger.left;
      left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
      const below = trigger.bottom + 6;
      const top =
        below + height > window.innerHeight - margin && trigger.top - 6 - height > margin
          ? trigger.top - 6 - height
          : below;
      setPosition({ top, left });
    };
    place();
    // Measure again once the popover has rendered with its real size.
    const frame = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align, view]);

  // Keep keyboard focus on the cursor day while navigating.
  useEffect(() => {
    if (open && view === 'days') {
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${cursor}"]`)?.focus();
    }
  }, [open, view, cursor]);

  const pick = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  const onGridKey = (e: KeyboardEvent) => {
    const weekday = (fromISODate(cursor).getDay() + 6) % 7;
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(cursor, -1),
      ArrowRight: () => addDays(cursor, 1),
      ArrowUp: () => addDays(cursor, -7),
      ArrowDown: () => addDays(cursor, 7),
      Home: () => addDays(cursor, -weekday),
      End: () => addDays(cursor, 6 - weekday),
      PageUp: () => shiftMonthKeepDay(cursor, -1),
      PageDown: () => shiftMonthKeepDay(cursor, 1),
    };
    if (moves[e.key]) {
      e.preventDefault();
      setCursor(moves[e.key]());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  const days = monthGrid(cursor);
  const cursorMonth = monthKey(cursor);
  const year = fromISODate(cursor).getFullYear();

  return (
    <div ref={rootRef} className={cn('relative', variant === 'field' && 'w-full')}>
      {variant === 'field' && label ? (
        <label htmlFor={fieldId} className="mb-1.5 block text-sm font-medium text-text">
          {label}
        </label>
      ) : null}
      <button
        ref={triggerRef}
        id={fieldId}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={variant === 'button' ? buttonLabel : undefined}
        className={cn(
          variant === 'field'
            ? 'flex w-full items-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-left text-base transition-colors duration-150 focus:border-black focus:outline-none'
            : 'inline-flex h-9 items-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-medium transition-colors duration-150 hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1 max-sm:w-9 max-sm:justify-center max-sm:px-0',
          open && variant === 'button' && 'bg-surface-muted',
        )}
      >
        <CalendarDays size={16} className="flex-shrink-0 text-text-secondary" />
        {variant === 'field' ? (
          <span className={cn('truncate', !value && 'text-text-tertiary')}>
            {value ? formatDay(value, lang) : (placeholder ?? t('pickDate'))}
          </span>
        ) : (
          <span className="hidden sm:inline">{buttonLabel ?? t('pickDate')}</span>
        )}
      </button>

      {open &&
        createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={label ?? buttonLabel ?? t('pickDate')}
          className="fixed z-[70] w-[18.5rem] rounded-xl border border-border bg-surface p-3 shadow-lg animate-[fadein_120ms_ease-out]"
          style={position ?? { top: -9999, left: -9999 }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
              triggerRef.current?.focus();
            }
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-1">
            <button
              type="button"
              onClick={() => setCursor(view === 'days' ? shiftMonthKeepDay(cursor, -1) : shiftYear(cursor, -1))}
              aria-label={view === 'days' ? t('previousMonth') : t('previousYear')}
              className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover hover:text-text"
            >
              <ChevronLeft size={17} />
            </button>
            <button
              type="button"
              onClick={() => setView((v) => (v === 'days' ? 'months' : 'days'))}
              aria-label={t('chooseMonthAndYear')}
              className="rounded-md px-2 py-1 text-sm font-semibold capitalize hover:bg-surface-hover"
            >
              {view === 'days' ? formatMonth(cursor, lang) : year}
            </button>
            <button
              type="button"
              onClick={() => setCursor(view === 'days' ? shiftMonthKeepDay(cursor, 1) : shiftYear(cursor, 1))}
              aria-label={view === 'days' ? t('nextMonth') : t('nextYear')}
              className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover hover:text-text"
            >
              <ChevronRight size={17} />
            </button>
          </div>

          {view === 'days' ? (
            <>
              <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
                {weekdayNames(lang, 'narrow').map((d, i) => (
                  <span key={i} className="py-1">
                    {d}
                  </span>
                ))}
              </div>
              <div ref={gridRef} role="grid" onKeyDown={onGridKey} className="grid grid-cols-7 gap-0.5">
                {days.map((iso) => {
                  const inMonth = monthKey(iso) === cursorMonth;
                  const selected = iso === value;
                  const isToday = iso === today;
                  return (
                    <button
                      key={iso}
                      type="button"
                      data-day={iso}
                      tabIndex={iso === cursor ? 0 : -1}
                      onClick={() => pick(iso)}
                      aria-label={formatDay(iso, lang)}
                      aria-pressed={selected}
                      className={cn(
                        'relative flex h-9 items-center justify-center rounded-md text-sm tabular-nums transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-black',
                        selected
                          ? 'bg-black font-semibold text-white'
                          : cn('hover:bg-surface-hover', inMonth ? 'text-text' : 'text-text-tertiary'),
                        isToday && !selected && 'font-semibold text-accent',
                      )}
                    >
                      {fromISODate(iso).getDate()}
                      {isToday && !selected ? (
                        <span className="absolute bottom-1 h-1 w-1 rounded-full bg-accent" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-3 gap-1.5 py-1">
              {monthNames(lang).map((name, month) => {
                const iso = `${year}-${String(month + 1).padStart(2, '0')}-01`;
                const current = monthKey(iso) === cursorMonth;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      setCursor(clampDay(cursor, year, month));
                      setView('days');
                    }}
                    className={cn(
                      'rounded-md py-2.5 text-sm capitalize transition-colors duration-100 hover:bg-surface-hover',
                      current && 'bg-surface-hover font-semibold',
                    )}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
            <button
              type="button"
              onClick={() => pick(today)}
              className="rounded-md px-2 py-1 text-sm font-medium text-accent hover:bg-surface-hover"
            >
              {t('today')}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-1 text-sm text-text-secondary hover:bg-surface-hover hover:text-text"
            >
              {t('close')}
            </button>
          </div>
        </div>,
        document.body,
        )}
    </div>
  );
};

// The same day in another month, clamped to that month's length (31 Jan → 29 Feb).
const clampDay = (iso: string, year: number, month: number) => {
  const day = fromISODate(iso).getDate();
  const last = new Date(year, month + 1, 0).getDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
};

const shiftMonthKeepDay = (iso: string, offset: number) => {
  const first = fromISODate(addMonths(iso, offset));
  return clampDay(iso, first.getFullYear(), first.getMonth());
};

const shiftYear = (iso: string, offset: number) => {
  const d = fromISODate(iso);
  return clampDay(iso, d.getFullYear() + offset, d.getMonth());
};
