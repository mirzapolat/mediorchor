import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  CalendarPlus,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Link2,
  NotebookPen,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { PageSpinner } from '@/components/Spinner';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
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
  type OccurrenceTarget,
} from '@/components/calendar/CalendarModals';
import { Modal } from '@/components/Modal';
import { CalendarLinksModal } from '@/components/calendar/CalendarLinksModal';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { localToday } from '@/lib/eventTiming';
import {
  addMonths,
  buildEntries,
  formatMonth,
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

const emptyData: CalendarData = {
  calendars: [],
  calendarProjects: [],
  calendarEvents: [],
  calendarEventExceptions: [],
  projects: [],
  rehearsals: [],
};

// Clicking a project (or a calendar's manual events) in the list narrows the
// grid to just those entries; clicking it again shows everything.
type Focus = { kind: 'project'; projectId: string } | { kind: 'manual'; calendarId: string };

const sameFocus = (a: Focus | null, b: Focus) =>
  a !== null &&
  (a.kind === 'project'
    ? b.kind === 'project' && a.projectId === b.projectId
    : b.kind === 'manual' && a.calendarId === b.calendarId);

// Desktop: the month grid fills the window below its top edge.
const DESKTOP = '(min-width: 1024px)';
const MIN_GRID_HEIGHT = 560;
const BOTTOM_GAP = 32;

// Kalender (dashboard tab): calendars on the left — each collects the
// rehearsals of its projects plus manual events of its own — and a month grid
// of the shown calendars on the right. Admins only.
export const CalendarPage = () => {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <NoAccess />;
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
  const [focus, setFocus] = useState<Focus | null>(null);
  const gridBox = useRef<HTMLDivElement>(null);
  const [gridHeight, setGridHeight] = useState<number | null>(null);

  const [openDay, setOpenDay] = useState<string | null>(null);
  const [calendarForm, setCalendarForm] = useState<{ open: boolean; calendar: Calendar | null }>({
    open: false,
    calendar: null,
  });
  const [eventForm, setEventForm] = useState<{
    open: boolean;
    event: CalendarEvent | null;
    occurrence?: OccurrenceTarget | null;
    calendarId: string | null;
    date: string | null;
  }>({ open: false, event: null, calendarId: null, date: null });
  // A repeating event picked in the day view: edit this occurrence or all?
  const [scopeFor, setScopeFor] = useState<Extract<CalendarEntry, { kind: 'event' }> | null>(null);
  const [subscribeId, setSubscribeId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Calendar | null>(null);

  const load = useCallback(async () => {
    setData(await loadCalendarData());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Desktop: size the grid to the space left in the window.
  useLayoutEffect(() => {
    const box = gridBox.current;
    const main = box?.closest('main');
    if (!box || !main) return;
    const media = window.matchMedia(DESKTOP);
    const update = () => {
      if (!media.matches) {
        setGridHeight(null);
        return;
      }
      const top = box.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
      setGridHeight(Math.max(MIN_GRID_HEIGHT, Math.floor(main.clientHeight - top - BOTTOM_GAP)));
    };
    update();
    window.addEventListener('resize', update);
    media.addEventListener('change', update);
    return () => {
      window.removeEventListener('resize', update);
      media.removeEventListener('change', update);
    };
  }, [loading]);

  const shown = useMemo(
    () => new Set(data.calendars.filter((c) => !hidden.has(c.id)).map((c) => c.id)),
    [data.calendars, hidden],
  );
  const entries = useMemo(() => {
    const all = buildEntries(data, shown);
    if (!focus) return all;
    return all.filter((entry) =>
      focus.kind === 'project'
        ? entry.kind === 'rehearsal' && entry.project.id === focus.projectId
        : entry.kind === 'event' && entry.event.calendar_id === focus.calendarId,
    );
  }, [data, shown, focus]);
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

  // Focusing something in a hidden calendar shows that calendar again.
  const toggleFocus = (next: Focus, calendarId: string) => {
    setFocus((current) => (sameFocus(current, next) ? null : next));
    if (hidden.has(calendarId)) toggleHidden(calendarId);
  };

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
    if (focus?.kind === 'manual' && focus.calendarId === toDelete.id) setFocus(null);
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
  const focusLabel = !focus
    ? null
    : focus.kind === 'project'
      ? (data.projects.find((p) => p.id === focus.projectId)?.name ?? '')
      : `${t('manualEvents')} · ${data.calendars.find((c) => c.id === focus.calendarId)?.name ?? ''}`;

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
        {/* Left: the calendars, each unfolding into its projects and manual events. */}
        <Card
          className="w-full !p-0 lg:w-80 lg:flex-shrink-0 lg:overflow-y-auto"
          style={gridHeight ? { maxHeight: gridHeight } : undefined}
        >
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
                  focus={focus}
                  onToggleExpanded={() => toggleExpanded(calendar.id)}
                  onToggleVisible={() => toggleHidden(calendar.id)}
                  onFocus={(next) => toggleFocus(next, calendar.id)}
                  onEdit={() => setCalendarForm({ open: true, calendar })}
                  onSubscribe={() => setSubscribeId(calendar.id)}
                  onDelete={() => setToDelete(calendar)}
                  onAddEvent={() => addEvent(calendar.id, null)}
                  onOpenProject={(projectId) => navigate(`/projects/${projectId}/events`)}
                />
              ))}
            </ul>
          )}
        </Card>

        {/* Right: the month grid; on desktop it fills the window. */}
        <div
          ref={gridBox}
          className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-surface"
          style={gridHeight ? { height: gridHeight } : undefined}
        >
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
            <div className="flex flex-wrap items-center gap-2">
              {focusLabel !== null && (
                <button
                  type="button"
                  onClick={() => setFocus(null)}
                  title={t('clearCalendarFilter')}
                  className="inline-flex h-9 max-w-[16rem] items-center gap-1.5 rounded-md border border-border bg-surface-muted pl-3 pr-2 text-sm font-medium hover:bg-surface-hover"
                >
                  <span className="min-w-0 truncate">{focusLabel}</span>
                  <X size={14} className="flex-shrink-0 text-text-secondary" />
                </button>
              )}
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
            fill={gridHeight !== null}
            month={month}
            entriesByDate={entriesByDate}
            colorOf={colorOf}
            onOpenDay={setOpenDay}
            onPage={(offset) => setMonth((m) => addMonths(m, offset))}
          />
        </div>
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
          addEvent(focus?.kind === 'manual' ? focus.calendarId : null, date);
        }}
        onEdit={(entry) => {
          setOpenDay(null);
          if (entry.event.repeat !== 'none') setScopeFor(entry);
          else setEventForm({ open: true, event: entry.event, calendarId: null, date: null });
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
        occurrence={eventForm.occurrence ?? null}
        defaults={{ calendarId: eventForm.calendarId, date: eventForm.date }}
        calendars={data.calendars}
        onClose={() => setEventForm({ open: false, event: null, calendarId: null, date: null })}
        onSaved={load}
      />

      <Modal
        open={scopeFor !== null}
        title={t('editRepeatingEvent')}
        onClose={() => setScopeFor(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setScopeFor(null)}>
              {t('cancel')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (scopeFor) setEventForm({ open: true, event: scopeFor.event, calendarId: null, date: null });
                setScopeFor(null);
              }}
            >
              {t('allOccurrences')}
            </Button>
            <Button
              onClick={() => {
                if (scopeFor) {
                  setEventForm({
                    open: true,
                    event: scopeFor.event,
                    occurrence: { date: scopeFor.occurrence, exception: scopeFor.exception },
                    calendarId: null,
                    date: null,
                  });
                }
                setScopeFor(null);
              }}
            >
              {t('thisOccurrence')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">{t('editRepeatingEventHint')}</p>
      </Modal>

      <CalendarLinksModal calendar={subscribing} onClose={() => setSubscribeId(null)} />

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

// One row under a calendar: a project, or the calendar's manual events shown
// like one. Clicking it filters the grid; the trailing action shows on hover.
const SourceRow = ({
  icon,
  label,
  meta,
  active,
  onClick,
  action,
}: {
  icon: ReactNode;
  label: string;
  meta?: string;
  active: boolean;
  onClick: () => void;
  action: ReactNode;
}) => (
  <div
    className={cn(
      'group/row flex items-center gap-1 rounded-md pr-1',
      active ? 'bg-surface-hover' : 'hover:bg-surface-muted',
    )}
  >
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 text-left text-sm"
    >
      {icon}
      <span className={cn('min-w-0 flex-1 truncate', active && 'font-semibold')}>{label}</span>
      {meta && <span className="flex-shrink-0 text-xs text-text-tertiary">{meta}</span>}
    </button>
    <span className="flex flex-shrink-0 items-center opacity-0 focus-within:opacity-100 group-hover/row:opacity-100 max-lg:opacity-100">
      {action}
    </span>
  </div>
);

const RowAction = ({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className="flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
  >
    {children}
  </button>
);

const CalendarListItem = ({
  calendar,
  data,
  expanded,
  visible,
  focus,
  onToggleExpanded,
  onToggleVisible,
  onFocus,
  onEdit,
  onSubscribe,
  onDelete,
  onAddEvent,
  onOpenProject,
}: {
  calendar: Calendar;
  data: CalendarData;
  expanded: boolean;
  visible: boolean;
  focus: Focus | null;
  onToggleExpanded: () => void;
  onToggleVisible: () => void;
  onFocus: (focus: Focus) => void;
  onEdit: () => void;
  onSubscribe: () => void;
  onDelete: () => void;
  onAddEvent: () => void;
  onOpenProject: (projectId: string) => void;
}) => {
  const { t } = useI18n();
  const today = localToday();

  const projectIds = new Set(
    data.calendarProjects.filter((cp) => cp.calendar_id === calendar.id).map((cp) => cp.project_id),
  );
  const projects = data.projects.filter((p) => projectIds.has(p.id));
  const upcomingManual = data.calendarEvents.filter((e) => e.calendar_id === calendar.id && e.date >= today).length;
  const manualFocus: Focus = { kind: 'manual', calendarId: calendar.id };

  return (
    <li>
      <div className="flex items-center gap-1 rounded-md pr-1 hover:bg-surface-muted">
        {/* A checkbox in the calendar's colour shows or hides it, like Google Calendar. */}
        <button
          type="button"
          role="checkbox"
          aria-checked={visible}
          onClick={onToggleVisible}
          aria-label={`${t('showCalendar')}: ${calendar.name}`}
          title={visible ? t('hideCalendar') : t('showCalendar')}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md hover:bg-surface-hover"
        >
          <span
            className="flex h-4 w-4 items-center justify-center rounded-[4px] border-2"
            style={{ borderColor: calendar.color, backgroundColor: visible ? calendar.color : 'transparent' }}
          >
            {visible && <Check size={11} strokeWidth={3.5} className="text-white" />}
          </span>
        </button>
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-2 text-left text-sm font-medium"
        >
          <span className={cn('min-w-0 truncate', !visible && 'text-text-tertiary')}>{calendar.name}</span>
          <ChevronDown
            size={15}
            className={cn('flex-shrink-0 text-text-tertiary transition-transform duration-150', !expanded && '-rotate-90')}
          />
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
        <div className="mb-2 ml-4 space-y-0.5 border-l border-border pl-2">
          {projects.map((p) => {
            const projectFocus: Focus = { kind: 'project', projectId: p.id };
            return (
              <SourceRow
                key={p.id}
                icon={<Avatar name={p.name} photoUrl={p.image_url} size={20} square />}
                label={p.name}
                meta={p.status === 'archived' ? t('archived') : undefined}
                active={sameFocus(focus, projectFocus)}
                onClick={() => onFocus(projectFocus)}
                action={
                  <RowAction label={t('openProject')} onClick={() => onOpenProject(p.id)}>
                    <ArrowUpRight size={14} />
                  </RowAction>
                }
              />
            );
          })}

          {/* Manual events, shown like a project of their own. */}
          <SourceRow
            icon={
              <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[5px] bg-surface-muted text-text-secondary">
                <NotebookPen size={12} />
              </span>
            }
            label={t('manualEvents')}
            meta={upcomingManual > 0 ? String(upcomingManual) : undefined}
            active={sameFocus(focus, manualFocus)}
            onClick={() => onFocus(manualFocus)}
            action={
              <RowAction label={t('addCalendarEvent')} onClick={onAddEvent}>
                <Plus size={14} />
              </RowAction>
            }
          />

          {projects.length === 0 && (
            <button
              type="button"
              onClick={onEdit}
              className="w-full rounded-md px-2 py-1.5 text-left text-sm text-text-secondary hover:bg-surface-muted hover:text-text"
            >
              {t('assignProjects')}
            </button>
          )}
        </div>
      )}
    </li>
  );
};
