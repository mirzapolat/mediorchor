import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Archive, ArchiveRestore, CalendarRange, Minus, Moon, Plus, Send, Undo2, X } from 'lucide-react';
import { MAX_DAYS, dayCount, nightCount, periodKey, type BookingPeriod } from '@shared/weekendNights';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { NoAccess } from '@/components/NoAccess';
import { ReleasePill, RoomsStatusActions, RoomsStatusPill, WeekendLinkControls } from '@/components/WeekendRelease';
import { Toast, useToast } from '@/components/Toast';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { nightsLabel, useWeekendContext, weekendDayLabels, type RoomsStatus } from '@/lib/weekends';

const sectionLabel = 'text-xs font-semibold uppercase tracking-wide text-text-tertiary';

// One setting: what it is and why, with its control.
const Row = ({ title, hint, children }: { title: ReactNode; hint: string; children: ReactNode }) => (
  <div className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
    <div className="min-w-0 flex-1 basis-64">
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">{title}</p>
      <p className="mt-0.5 text-sm text-text-secondary">{hint}</p>
    </div>
    <div className="flex flex-wrap gap-2">{children}</div>
  </div>
);

const ROOMS_TOAST: Record<RoomsStatus, TranslationKey> = {
  hidden: 'weekendRoomsDisabledToast',
  open: 'weekendRoomsReleasedToast',
  locked: 'weekendRoomsLockedToast',
};

// A weekend's "Einstellungen" (managers): what participants see (details and
// room allocation, released one by one), how many days it lasts and over
// which nights each booked period goes, and archiving.
export const WeekendSettingsPage = () => {
  const { t } = useI18n();
  const { weekend, canManage, reloadWeekend, reloadNav } = useWeekendContext();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  if (!canManage) return <NoAccess />;

  const patch = async (values: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const { error: saveError } = await api.from('weekends').update(values).eq('id', weekend.id);
    setBusy(false);
    if (saveError) {
      setError(`${t('saveFailed')} (${saveError.message})`);
      return false;
    }
    await reloadWeekend();
    void reloadNav?.();
    return true;
  };

  // Reversible: done, with "Rückgängig" in the toast.
  const change = async (values: Record<string, unknown>, previous: Record<string, unknown>, message: TranslationKey) => {
    if (await patch(values)) toast.show(t(message), () => void patch(previous));
  };

  return (
    <div className="max-w-3xl space-y-6 pb-10">
      <h1 className="text-xl font-bold sm:text-2xl">{t('settings')}</h1>
      {error && <p className="text-sm text-danger">{error}</p>}

      <section>
        <h2 className={cn(sectionLabel, 'mb-2')}>{t('weekendVisibility')}</h2>
        <Card className="p-4 sm:p-5">
          <div className="divide-y divide-border">
            <Row
              title={
                <>
                  {t('weekendDetails')}
                  <ReleasePill released={weekend.details_published} />
                </>
              }
              hint={t('weekendDetailsReleaseHint')}
            >
              {weekend.details_published ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void change({ details_published: false }, { details_published: true }, 'weekendDetailsWithdrawnToast')}
                >
                  <Undo2 size={16} />
                  {t('weekendDetailsWithdraw')}
                </Button>
              ) : (
                <Button
                  disabled={busy || weekend.archived}
                  onClick={() => void change({ details_published: true }, { details_published: false }, 'weekendDetailsReleasedToast')}
                >
                  <Send size={16} />
                  {t('weekendDetailsRelease')}
                </Button>
              )}
            </Row>
            <Row
              title={
                <>
                  {t('weekendRoomAllocation')}
                  <RoomsStatusPill status={weekend.rooms_status} />
                </>
              }
              hint={t('weekendRoomAllocationHint')}
            >
              <RoomsStatusActions
                status={weekend.rooms_status}
                busy={busy || weekend.archived}
                onChange={(next) => void change({ rooms_status: next }, { rooms_status: weekend.rooms_status }, ROOMS_TOAST[next])}
              />
            </Row>
            <Row title={t('weekendShareLink')} hint={t('weekendShareLinkHint')}>
              <WeekendLinkControls full weekend={weekend} onChanged={() => void reloadWeekend()} onMessage={(m) => toast.show(m)} />
            </Row>
          </div>
        </Card>
      </section>

      <section>
        <h2 className={cn(sectionLabel, 'mb-2')}>{t('weekendNightsTitle')}</h2>
        <Card className="space-y-5 p-4 sm:p-5">
          <DaysStepper onSave={(days) => void patch({ days })} busy={busy} />
          <PeriodEditor onSave={(periods) => void patch({ periods })} />
        </Card>
      </section>

      <section>
        <h2 className={cn(sectionLabel, 'mb-2')}>{t('lifecycleArchived')}</h2>
        <Card className="p-4 sm:p-5">
          <Row title={weekend.archived ? t('lifecycleArchived') : t('lifecycleArchive')} hint={t('weekendArchiveHint')}>
            {weekend.archived ? (
              <Button variant="secondary" disabled={busy} onClick={() => void change({ archived: false }, { archived: true }, 'weekendRestoredToast')}>
                <ArchiveRestore size={16} />
                {t('lifecycleRestore')}
              </Button>
            ) : (
              <Button variant="secondary" disabled={busy} onClick={() => void change({ archived: true }, { archived: false }, 'weekendArchivedToast')}>
                <Archive size={16} />
                {t('lifecycleArchive')}
              </Button>
            )}
          </Row>
        </Card>
      </section>
      <Toast toast={toast.toast} onClose={toast.hide} />
    </div>
  );
};

// How many days the weekend lasts — from its dates until set here.
const DaysStepper = ({ onSave, busy }: { onSave: (days: number | null) => void; busy: boolean }) => {
  const { t } = useI18n();
  const { weekend } = useWeekendContext();
  const days = dayCount(weekend);
  const fromDates = weekend.starts_on && weekend.ends_on ? dayCount({ ...weekend, days: null }) : null;
  const stepButton =
    'flex h-9 w-9 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover hover:text-text disabled:opacity-30';
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm font-medium">{t('weekendDays')}</p>
        <p className="text-xs text-text-tertiary">
          {t('weekendNightsCount').replace('{n}', String(Math.max(0, days - 1)))}
          {weekend.days == null && fromDates != null && ` · ${t('weekendDaysFromDates')}`}
        </p>
      </div>
      {weekend.days != null && fromDates != null && weekend.days !== fromDates && (
        <button type="button" className="text-xs text-text-secondary underline hover:text-text" onClick={() => onSave(null)}>
          {t('weekendDaysUseDates').replace('{n}', String(fromDates))}
        </button>
      )}
      <div className="flex items-center rounded-lg border border-border">
        <button type="button" aria-label={t('weekendDaysLess')} className={stepButton} disabled={busy || days <= 1} onClick={() => onSave(days - 1)}>
          <Minus size={15} />
        </button>
        <span className="w-8 text-center text-sm font-semibold tabular-nums">{days}</span>
        <button
          type="button"
          aria-label={t('weekendDaysMore')}
          className={stepButton}
          disabled={busy || days >= MAX_DAYS}
          onClick={() => onSave(days + 1)}
        >
          <Plus size={15} />
        </button>
      </div>
    </div>
  );
};

type DragMode = 'move' | 'from' | 'to';

// The days as tiles with the nights between them; each booked period (as
// the participants were imported with it) is a bar over its nights — moved
// by dragging, made longer or shorter at its ends. People whose periods
// don't overlap share a place in a room. A period not placed counts as the
// whole weekend.
const PeriodEditor = ({ onSave }: { onSave: (periods: BookingPeriod[]) => void }) => {
  const { t, lang } = useI18n();
  const { weekend } = useWeekendContext();
  const [periods, setPeriods] = useState<BookingPeriod[]>(weekend.periods);
  const [bookings, setBookings] = useState<Map<string, { label: string; n: number }>>(new Map());
  const [dropping, setDropping] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ label: string; mode: DragMode; x: number; from: number; to: number; moved: boolean } | null>(null);

  // The bars as last drawn, saved when a drag ends.
  const latest = useRef(periods);
  latest.current = periods;

  useEffect(() => setPeriods(weekend.periods), [weekend.periods]);
  useEffect(() => {
    void api
      .from('weekend_participants')
      .select('booking')
      .eq('weekend_id', weekend.id)
      .then(({ data }) => {
        const counts = new Map<string, { label: string; n: number }>();
        for (const { booking } of (data as { booking: string | null }[] | null) ?? []) {
          const key = periodKey(booking);
          if (!key) continue;
          const known = counts.get(key);
          counts.set(key, { label: known?.label ?? booking!.trim(), n: (known?.n ?? 0) + 1 });
        }
        setBookings(counts);
      });
  }, [weekend.id]);

  const days = dayCount(weekend);
  const nights = nightCount(weekend);
  const tiles = weekendDayLabels(weekend, lang, t('weekendDay'));
  const countOf = (label: string) => bookings.get(periodKey(label))?.n ?? 0;
  const placed = new Set(periods.map((p) => periodKey(p.label)));
  const unplaced = [...bookings.values()].filter((b) => !placed.has(periodKey(b.label)));
  // Within the weekend's current nights (a shorter weekend cuts bars off).
  const shown = periods.map((p) => ({ ...p, from: Math.min(p.from, nights - 1), to: Math.min(p.to, nights - 1) }));

  const commit = (next: BookingPeriod[]) => {
    setPeriods(next);
    onSave(next);
  };
  const place = (label: string, from: number, to: number) =>
    commit([...periods.filter((p) => periodKey(p.label) !== periodKey(label)), { label, from, to }]);
  const remove = (label: string) => commit(periods.filter((p) => p.label !== label));

  const nightWidth = () => (trackRef.current?.getBoundingClientRect().width ?? 1) / days;

  const startDrag = (e: PointerEvent, period: BookingPeriod, mode: DragMode) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { label: period.label, mode, x: e.clientX, from: period.from, to: period.to, moved: false };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const steps = Math.round((e.clientX - d.x) / nightWidth());
    let from = d.from;
    let to = d.to;
    if (d.mode === 'move') {
      const shift = Math.max(-d.from, Math.min(nights - 1 - d.to, steps));
      from += shift;
      to += shift;
    } else if (d.mode === 'from') {
      from = Math.max(0, Math.min(d.to, d.from + steps));
    } else {
      to = Math.max(d.from, Math.min(nights - 1, d.to + steps));
    }
    if (from !== d.from || to !== d.to) d.moved = true;
    setPeriods((list) => list.map((p) => (p.label === d.label ? { ...p, from, to } : p)));
  };
  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) onSave(latest.current);
  };

  // Arrows move a bar; with Shift they move its end (longer, shorter).
  const onKey = (e: KeyboardEvent, period: BookingPeriod) => {
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!step) return;
    e.preventDefault();
    const { from, to } = period;
    if (e.shiftKey) place(period.label, from, Math.max(from, Math.min(nights - 1, to + step)));
    else if (from + step >= 0 && to + step <= nights - 1) place(period.label, from + step, to + step);
  };

  // A label dropped onto the days covers the night under the pointer.
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const label = e.dataTransfer.getData('text/plain');
    if (!label || !trackRef.current) return;
    const x = e.clientX - trackRef.current.getBoundingClientRect().left;
    const night = Math.max(0, Math.min(nights - 1, Math.floor(x / nightWidth() - 0.5)));
    place(label, night, night);
  };

  const pct = (n: number) => `${(n / days) * 100}%`;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium">{t('weekendPeriods')}</p>
        <p className="mt-0.5 text-sm text-text-secondary">{t('weekendPeriodsHint')}</p>
      </div>

      <div
        className={cn('-m-1 rounded-xl p-1 transition-colors', dropping && 'bg-accent/10')}
        onDragOver={(e) => {
          if (days < 2) return;
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
      >
        <div ref={trackRef} className="relative">
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }}>
            {tiles.map((tile, i) => (
              <div key={i} className="rounded-xl border border-border bg-surface-subtle px-1 py-2 text-center">
                <p className="truncate text-sm font-semibold">{tile.weekday}</p>
                {tile.date && <p className="truncate text-xs text-text-tertiary">{tile.date}</p>}
              </div>
            ))}
          </div>
          {days > 1 && (
            <>
              <div className="relative mt-1 h-5" aria-hidden>
                {Array.from({ length: nights }, (_, night) => (
                  <span
                    key={night}
                    className="absolute top-0 flex -translate-x-1/2 items-center gap-0.5 whitespace-nowrap text-[10px] font-semibold text-text-tertiary"
                    style={{ left: pct(night + 1) }}
                  >
                    <Moon size={10} />
                    {night + 1}
                  </span>
                ))}
              </div>
              <div className="mt-1 space-y-1.5" onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
                {shown.map((p) => (
                  <div key={p.label} className="relative h-8">
                    <div
                      role="slider"
                      tabIndex={0}
                      aria-label={p.label}
                      aria-valuemin={1}
                      aria-valuemax={nights}
                      aria-valuenow={p.from + 1}
                      aria-valuetext={nightsLabel([p.from, p.to], t('weekendNight'))}
                      title={`${p.label} · ${nightsLabel([p.from, p.to], t('weekendNight'))}`}
                      onPointerDown={(e) => startDrag(e, p, 'move')}
                      onKeyDown={(e) => onKey(e, p)}
                      className="group/bar absolute inset-y-0 flex min-w-[2.5rem] cursor-grab touch-none select-none items-center gap-1.5 rounded-full border border-accent/50 bg-accent/15 px-3 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
                      style={{ left: pct(p.from + 0.5), width: pct(p.to - p.from + 1) }}
                    >
                      <span
                        aria-hidden
                        onPointerDown={(e) => startDrag(e, p, 'from')}
                        className="absolute inset-y-0 left-0 w-2.5 cursor-ew-resize rounded-l-full hover:bg-accent/30"
                      />
                      <span className="min-w-0 flex-1 truncate">{p.label}</span>
                      <span className="flex-shrink-0 text-text-tertiary">{countOf(p.label)}</span>
                      <button
                        type="button"
                        aria-label={`${t('remove')}: ${p.label}`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => remove(p.label)}
                        className="-mr-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-text-tertiary opacity-0 hover:bg-surface hover:text-text focus:opacity-100 group-hover/bar:opacity-100 max-lg:opacity-100"
                      >
                        <X size={12} />
                      </button>
                      <span
                        aria-hidden
                        onPointerDown={(e) => startDrag(e, p, 'to')}
                        className="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize rounded-r-full hover:bg-accent/30"
                      />
                    </div>
                  </div>
                ))}
                {shown.length === 0 && (
                  <p className="rounded-lg border border-dashed border-border px-3 py-2 text-center text-xs text-text-tertiary">
                    {t('weekendPeriodsDropHere')}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {days < 2 ? (
        <p className="text-sm text-text-tertiary">{t('weekendPeriodsOneDay')}</p>
      ) : unplaced.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs text-text-tertiary">{t('weekendPeriodsUnplaced')}</p>
          <ul className="flex flex-wrap gap-1.5">
            {unplaced.map((b) => (
              <li key={b.label}>
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', b.label)}
                  onClick={() => place(b.label, 0, nights - 1)}
                  title={t('weekendPeriodPlace')}
                  className="inline-flex h-7 cursor-grab items-center gap-1.5 rounded-full border border-dashed border-border-strong px-2.5 text-xs hover:border-accent hover:bg-accent/10"
                >
                  <CalendarRange size={12} className="text-text-tertiary" />
                  {b.label}
                  <span className="text-text-tertiary">{b.n}</span>
                  <Plus size={12} className="text-text-tertiary" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        bookings.size === 0 && <p className="text-xs text-text-tertiary">{t('weekendPeriodsNone')}</p>
      )}
    </div>
  );
};
