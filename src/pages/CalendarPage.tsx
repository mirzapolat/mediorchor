import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarPlus,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  FolderKanban,
  Link2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { PageSpinner } from '@/components/Spinner';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { HeaderAction } from '@/components/HeaderAction';
import { OverflowMenu } from '@/components/OverflowMenu';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { NoAccess } from '@/components/NoAccess';
import { DatePicker } from '@/components/DatePicker';
import { MonthGrid } from '@/components/calendar/MonthGrid';
import {
  CalendarEventModal,
  CalendarFormModal,
  DayPreviewModal,
  SubscribeModal,
} from '@/components/calendar/CalendarModals';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { localToday } from '@/lib/eventTiming';
import {
  addMonths,
  buildEntries,
  formatMonth,
  fromISODate,
  groupByDate,
  loadCalendarData,
  monthKey,
  type CalendarData,
  type CalendarEntry,
} from '@/lib/calendar';
import type { Calendar, CalendarEvent } from '@/types';

// Which calendars are hidden in the grid: a per-browser convenience.
const HIDDEN_KEY = 'calendar-hidden';
const readHidden = () => {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]'));
  } catch {
    return new Set<string>();
  }
};
const writeHidden = (hidden: Set<string>) => {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
  } catch {
    // Storage unavailable (private mode): the choice lasts for this visit.
  }
};

const emptyData: CalendarData = { calendars: [], calendarProjects: [], calendarEvents: [], projects: [], rehearsals: [] };

// Kalender (dashboard tab): calendars on the left — each collects the
// rehearsals of its projects plus events of its own — and a month grid of
// the shown calendars on the right. For those with access to all projects.
export const CalendarPage = () => {
  const { canManageProjects } = useAuth();
  if (!canManageProjects) return <NoAccess />;
  return <CalendarView />;
};

const CalendarView = () => {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [data, setData] = useState<CalendarData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => `${monthKey(localToday())}-01`);
  const [hidden, setHidden] = useState(readHidden);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [openDay, setOpenDay] = useState<string | null>(null);
  const [calendarForm, setCalendarForm] = useState<{ open: boolean; calendar: Calendar | null }>({
    open: false,
    calendar: null,
  });
  const [eventForm, setEventForm] = useState<{
    open: boolean;
    event: CalendarEvent | null;
    calendarId: string | null;
    date: string | null;
  }>({ open: false, event: null, calendarId: null, date: null });
  const [subscribeId, setSubscribeId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Calendar | null>(null);

  const load = useCallback(async () => {
    setData(await loadCalendarData());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(
    () => new Set(data.calendars.filter((c) => !hidden.has(c.id)).map((c) => c.id)),
    [data.calendars, hidden],
  );
  const entries = useMemo(() => buildEntries(data, shown), [data, shown]);
  const entriesByDate = useMemo(() => groupByDate(entries), [entries]);
  const colorById = useMemo(() => new Map(data.calendars.map((c) => [c.id, c.color])), [data.calendars]);
  const colorOf = useCallback(
    (entry: CalendarEntry) => colorById.get(entry.calendarIds[0]) ?? '#64748b',
    [colorById],
  );

  const toggleHidden = (id: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeHidden(next);
      return next;
    });

  const toggleExpanded = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addEvent = (calendarId: string | null, date: string | null) =>
    setEventForm({ open: true, event: null, calendarId, date });

  const removeCalendar = async () => {
    if (!toDelete) return;
    await api.from('calendars').delete().eq('id', toDelete.id);
    setToDelete(null);
    await load();
  };

  const jumpTo = (iso: string) => {
    setMonth(`${monthKey(iso)}-01`);
    setOpenDay(iso);
  };

  if (loading) return <PageSpinner />;

  const today = localToday();
  const showingToday = monthKey(month) === monthKey(today);
  const subscribing = data.calendars.find((c) => c.id === subscribeId) ?? null;

  return (
    <>
      <PageHeader
        title={t('calendars')}
        inlineActions
        actions={
          <HeaderAction
            icon={CalendarPlus}
            label={t('addCalendarEvent')}
            disabled={data.calendars.length === 0}
            onClick={() => addEvent(null, null)}
          />
        }
      />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Left: the calendars, each unfolding into its projects and events. */}
        <Card className="w-full !p-0 lg:sticky lg:top-6 lg:w-80 lg:flex-shrink-0">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">{t('calendarList')}</h2>
            <button
              type="button"
              onClick={() => setCalendarForm({ open: true, calendar: null })}
              aria-label={t('newCalendar')}
              title={t('newCalendar')}
              className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover hover:text-text"
            >
              <Plus size={17} />
            </button>
          </div>

          {data.calendars.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <CalendarRange size={28} className="mx-auto text-text-tertiary" />
              <p className="mt-3 text-sm text-text-secondary">{t('noCalendars')}</p>
              <Button className="mt-4" onClick={() => setCalendarForm({ open: true, calendar: null })}>
                <Plus size={16} />
                {t('newCalendar')}
              </Button>
            </div>
          ) : (
            <ul className="p-2">
              {data.calendars.map((calendar) => (
                <CalendarListItem
                  key={calendar.id}
                  calendar={calendar}
                  data={data}
                  expanded={expanded.has(calendar.id)}
                  visible={!hidden.has(calendar.id)}
                  onToggleExpanded={() => toggleExpanded(calendar.id)}
                  onToggleVisible={() => toggleHidden(calendar.id)}
                  onEdit={() => setCalendarForm({ open: true, calendar })}
                  onSubscribe={() => setSubscribeId(calendar.id)}
                  onDelete={() => setToDelete(calendar)}
                  onAddEvent={() => addEvent(calendar.id, null)}
                  onEditEvent={(event) => setEventForm({ open: true, event, calendarId: null, date: null })}
                  onOpenProject={(projectId) => navigate(`/projects/${projectId}/events`)}
                />
              ))}
            </ul>
          )}
        </Card>

        {/* Right: the month grid. */}
        <Card className="min-w-0 flex-1 overflow-hidden !p-0">
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
              <Button
                variant="secondary"
                className="!h-9 !py-0"
                disabled={showingToday}
                onClick={() => setMonth(`${monthKey(today)}-01`)}
              >
                {t('today')}
              </Button>
              <DatePicker variant="button" align="right" value={null} buttonLabel={t('goToDate')} onChange={jumpTo} />
            </div>
          </div>
          <MonthGrid
            month={month}
            entriesByDate={entriesByDate}
            colorOf={colorOf}
            onOpenDay={setOpenDay}
            onPage={(offset) => setMonth((m) => addMonths(m, offset))}
          />
        </Card>
      </div>

      <DayPreviewModal
        date={openDay}
        entries={openDay ? (entriesByDate.get(openDay) ?? []) : []}
        calendars={data.calendars}
        colorOf={colorOf}
        canAdd={data.calendars.length > 0}
        onClose={() => setOpenDay(null)}
        onAdd={(date) => {
          setOpenDay(null);
          addEvent(null, date);
        }}
        onEdit={(event) => {
          setOpenDay(null);
          setEventForm({ open: true, event, calendarId: null, date: null });
        }}
        onOpenRehearsal={(projectId, eventId) => navigate(`/projects/${projectId}/events/${eventId}`)}
      />

      <CalendarFormModal
        open={calendarForm.open}
        calendar={calendarForm.calendar}
        data={data}
        onClose={() => setCalendarForm({ open: false, calendar: null })}
        onSaved={load}
      />

      <CalendarEventModal
        open={eventForm.open}
        event={eventForm.event}
        defaults={{ calendarId: eventForm.calendarId, date: eventForm.date }}
        calendars={data.calendars}
        onClose={() => setEventForm({ open: false, event: null, calendarId: null, date: null })}
        onSaved={load}
      />

      <SubscribeModal calendar={subscribing} onClose={() => setSubscribeId(null)} onRenewed={load} />

      <ConfirmDialog
        open={!!toDelete}
        title={t('deleteCalendar')}
        message={t('deleteCalendarConfirm').replace('{name}', toDelete?.name ?? '')}
        confirmLabel={t('delete')}
        destructive
        onConfirm={removeCalendar}
        onCancel={() => setToDelete(null)}
      />
    </>
  );
};

// Upcoming own events listed in a calendar's "Events" entry before "show all".
const EVENTS_PREVIEW = 5;

const CalendarListItem = ({
  calendar,
  data,
  expanded,
  visible,
  onToggleExpanded,
  onToggleVisible,
  onEdit,
  onSubscribe,
  onDelete,
  onAddEvent,
  onEditEvent,
  onOpenProject,
}: {
  calendar: Calendar;
  data: CalendarData;
  expanded: boolean;
  visible: boolean;
  onToggleExpanded: () => void;
  onToggleVisible: () => void;
  onEdit: () => void;
  onSubscribe: () => void;
  onDelete: () => void;
  onAddEvent: () => void;
  onEditEvent: (event: CalendarEvent) => void;
  onOpenProject: (projectId: string) => void;
}) => {
  const { t, lang } = useI18n();
  const [showAllEvents, setShowAllEvents] = useState(false);
  const today = localToday();

  const projectIds = new Set(
    data.calendarProjects.filter((cp) => cp.calendar_id === calendar.id).map((cp) => cp.project_id),
  );
  const projects = data.projects.filter((p) => projectIds.has(p.id));
  const ownEvents = data.calendarEvents.filter((e) => e.calendar_id === calendar.id);
  const upcoming = ownEvents.filter((e) => e.date >= today);
  const listedEvents = showAllEvents ? ownEvents : upcoming.slice(0, EVENTS_PREVIEW);

  return (
    <li>
      <div className="group flex items-center gap-1 rounded-md pr-1 hover:bg-surface-muted">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-2 text-left text-sm font-medium"
        >
          <ChevronDown
            size={15}
            className={cn('flex-shrink-0 text-text-tertiary transition-transform duration-150', !expanded && '-rotate-90')}
          />
          <span
            className={cn('h-3 w-3 flex-shrink-0 rounded-[4px]', !visible && 'opacity-30')}
            style={{ backgroundColor: calendar.color }}
          />
          <span className={cn('min-w-0 truncate', !visible && 'text-text-tertiary')}>{calendar.name}</span>
        </button>
        <button
          type="button"
          onClick={onToggleVisible}
          aria-label={visible ? t('hideCalendar') : t('showCalendar')}
          title={visible ? t('hideCalendar') : t('showCalendar')}
          className={cn(
            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text',
            visible && 'opacity-0 focus:opacity-100 group-hover:opacity-100 max-lg:opacity-100',
          )}
        >
          {visible ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
        <OverflowMenu
          label={t('moreActions')}
          items={[
            { icon: Pencil, label: t('editCalendar'), onSelect: onEdit },
            { icon: Link2, label: t('subscribeCalendar'), onSelect: onSubscribe },
            { icon: Trash2, label: t('deleteCalendar'), onSelect: onDelete, separated: true },
          ]}
        />
      </div>

      {expanded && (
        <div className="mb-2 ml-[1.15rem] border-l border-border pl-3">
          <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
            {t('projects')}
          </p>
          {projects.length === 0 ? (
            <button
              type="button"
              onClick={onEdit}
              className="w-full rounded-md px-2 py-1.5 text-left text-sm text-text-secondary hover:bg-surface-muted hover:text-text"
            >
              {t('assignProjects')}
            </button>
          ) : (
            projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpenProject(p.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-muted"
              >
                <FolderKanban size={14} className="flex-shrink-0 text-text-tertiary" />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.status === 'archived' && <span className="text-xs text-text-tertiary">{t('archived')}</span>}
              </button>
            ))
          )}

          <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
              {t('calendarEventsEntry')}
            </p>
            <button
              type="button"
              onClick={onAddEvent}
              aria-label={t('addCalendarEvent')}
              title={t('addCalendarEvent')}
              className="flex h-6 w-6 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover hover:text-text"
            >
              <Plus size={14} />
            </button>
          </div>
          {listedEvents.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-text-tertiary">
              {ownEvents.length === 0 ? t('noCalendarEvents') : t('noUpcomingCalendarEvents')}
            </p>
          )}
          {listedEvents.map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={() => onEditEvent(event)}
              className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-muted"
            >
              <span className="w-11 flex-shrink-0 text-xs tabular-nums text-text-secondary">
                {fromISODate(event.date).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', {
                  day: '2-digit',
                  month: '2-digit',
                })}
              </span>
              <span className={cn('min-w-0 flex-1 truncate', event.date < today && 'text-text-tertiary')}>
                {event.name}
              </span>
              {event.start_time && (
                <span className="flex-shrink-0 text-xs tabular-nums text-text-tertiary">{event.start_time}</span>
              )}
            </button>
          ))}
          {ownEvents.length > listedEvents.length || showAllEvents ? (
            <button
              type="button"
              onClick={() => setShowAllEvents((v) => !v)}
              className="px-2 py-1 text-xs font-medium text-text-secondary hover:text-text"
            >
              {showAllEvents ? t('showLess') : `${t('showAllEvents')} (${ownEvents.length})`}
            </button>
          ) : null}
        </div>
      )}
    </li>
  );
};
