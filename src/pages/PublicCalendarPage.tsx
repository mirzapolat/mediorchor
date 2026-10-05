import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { CalendarX2, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { PageSpinner } from '@/components/Spinner';
import { Button } from '@/components/Button';
import { LegalFooter } from '@/components/LegalLinks';
import { MonthGrid } from '@/components/calendar/MonthGrid';
import { DayPreviewModal } from '@/components/calendar/CalendarModals';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { localToday } from '@/lib/eventTiming';
import {
  addMonths,
  buildEntries,
  feedUrls,
  formatMonth,
  groupByDate,
  monthKey,
  type CalendarData,
  type CalendarEntry,
} from '@/lib/calendar';
import type { Calendar, CalendarEvent, CalendarEventException, Event } from '@/types';

interface PublicCalendar {
  state: 'ok' | 'invalid';
  calendar: { id: string; name: string; color: string };
  rehearsals: (Pick<Event, 'id' | 'project_id' | 'name' | 'date' | 'time' | 'end_time' | 'location' | 'description'> & {
    project_name: string;
  })[];
  events: Omit<CalendarEvent, 'calendar_id' | 'created_at'>[];
  exceptions: Omit<CalendarEventException, 'created_at'>[];
}

// Public, read-only web view of a calendar link (/cal/<token>, server/rpc.ts
// get_public_calendar): the month grid plus ways to subscribe. With ?embed=1
// it drops the page chrome for an <iframe> on another website.
export const PublicCalendarPage = () => {
  const { t, lang } = useI18n();
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  const embed = params.get('embed') === '1';
  const [result, setResult] = useState<PublicCalendar | null>(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => `${monthKey(localToday())}-01`);
  const [openDay, setOpenDay] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await api.rpc('get_public_calendar', { p_token: token });
    setResult((data as PublicCalendar | null) ?? null);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // The shape the app's own grid works with.
  const data = useMemo<CalendarData | null>(() => {
    if (!result || result.state !== 'ok') return null;
    const calendar = { ...result.calendar, reminder_minutes: null, position: 0, created_at: '' } as Calendar;
    const projectIds = [...new Set(result.rehearsals.map((r) => r.project_id))];
    return {
      calendars: [calendar],
      calendarProjects: projectIds.map((project_id) => ({
        id: project_id,
        calendar_id: calendar.id,
        project_id,
        created_at: '',
      })),
      calendarEvents: result.events.map((e) => ({ ...e, calendar_id: calendar.id, created_at: '' })),
      calendarEventExceptions: (result.exceptions ?? []).map((x) => ({ ...x, created_at: '' })),
      projects: projectIds.map((id) => ({
        id,
        name: result.rehearsals.find((r) => r.project_id === id)?.project_name ?? '',
        status: 'active' as const,
        image_url: null,
      })),
      rehearsals: result.rehearsals as unknown as Event[],
    };
  }, [result]);

  const entriesByDate = useMemo(
    () =>
      data ? groupByDate(buildEntries(data, new Set([data.calendars[0].id]))) : new Map<string, CalendarEntry[]>(),
    [data],
  );

  if (loading) return <PageSpinner />;

  if (!data || !result) {
    return (
      <main className="flex min-h-full flex-col items-center justify-center px-4 py-16 text-center">
        <CalendarX2 size={32} className="text-text-tertiary" />
        <h1 className="mt-4 text-lg font-semibold">{t('publicCalendarInvalid')}</h1>
        <p className="mt-1 max-w-sm text-sm text-text-secondary">{t('publicCalendarInvalidHint')}</p>
      </main>
    );
  }

  const color = result.calendar.color;
  const urls = feedUrls(token);
  const showingToday = monthKey(month) === monthKey(localToday());
  const appLink =
    'inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-surface-muted';

  return (
    <main className={cn('min-h-full', embed ? 'p-2' : 'px-4 py-8 sm:px-6 sm:py-12')}>
      <div className={cn('mx-auto', !embed && 'max-w-5xl')}>
        {!embed && (
          <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="h-4 w-4 flex-shrink-0 rounded-[5px]" style={{ backgroundColor: color }} />
              <h1 className="text-2xl font-bold">{result.calendar.name}</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={urls.google} target="_blank" rel="noopener noreferrer" className={appLink}>
                <ExternalLink size={15} />
                {t('openInGoogleCalendar')}
              </a>
              <a href={urls.webcal} className={appLink}>
                <ExternalLink size={15} />
                {t('openInAppleCalendar')}
              </a>
            </div>
          </header>
        )}

        <div className="overflow-hidden rounded-md border border-border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-3 sm:px-4">
            <div className="flex items-center gap-1">
              <h2 className="mr-2 text-lg font-semibold capitalize sm:min-w-[11rem]">{formatMonth(month, lang)}</h2>
              <button
                type="button"
                onClick={() => setMonth(addMonths(month, -1))}
                aria-label={t('previousMonth')}
                title={t('previousMonth')}
                className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover hover:text-text"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                onClick={() => setMonth(addMonths(month, 1))}
                aria-label={t('nextMonth')}
                title={t('nextMonth')}
                className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover hover:text-text"
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              {embed && <span className="text-sm font-medium text-text-secondary">{result.calendar.name}</span>}
              <Button
                variant="secondary"
                className="!h-9 !py-0"
                disabled={showingToday}
                onClick={() => setMonth(`${monthKey(localToday())}-01`)}
              >
                {t('today')}
              </Button>
            </div>
          </div>
          <MonthGrid
            month={month}
            entriesByDate={entriesByDate}
            colorOf={() => color}
            onOpenDay={setOpenDay}
            onPage={(offset) => setMonth((m) => addMonths(m, offset))}
          />
        </div>

        {!embed && <LegalFooter className="mt-8" />}
      </div>

      <DayPreviewModal
        date={openDay}
        entries={openDay ? (entriesByDate.get(openDay) ?? []) : []}
        calendars={data.calendars}
        colorOf={() => color}
        canAdd={false}
        readOnly
        onClose={() => setOpenDay(null)}
        onAdd={() => {}}
        onEdit={() => {}}
        onOpenRehearsal={() => {}}
      />
    </main>
  );
};
