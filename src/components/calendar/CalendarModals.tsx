import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Bell,
  Check,
  Clock,
  ExternalLink,
  MapPin,
  Pencil,
  Plus,
  Repeat,
  Search,
  StickyNote,
  Trash2,
  Undo2,
} from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { DatePicker } from '@/components/DatePicker';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { GROUP_PALETTE, paletteColor } from '@/lib/groupColors';
import { formatDay, shiftedEnd, timeRange, type CalendarData, type CalendarEntry } from '@/lib/calendar';
import type { Calendar, CalendarEvent, CalendarEventException, CalendarRepeat } from '@/types';

// --- Day preview -----------------------------------------------------------------

// Everything on one day: rehearsals open their Probe, own events can be
// edited; a new event starts on this day.
export const DayPreviewModal = ({
  date,
  entries,
  calendars,
  colorOf,
  canAdd,
  onClose,
  onAdd,
  onEdit,
  onOpenRehearsal,
  readOnly = false,
}: {
  date: string | null;
  entries: CalendarEntry[];
  calendars: Calendar[];
  colorOf: (entry: CalendarEntry) => string;
  canAdd: boolean;
  onClose: () => void;
  onAdd: (date: string) => void;
  onEdit: (entry: Extract<CalendarEntry, { kind: 'event' }>) => void;
  onOpenRehearsal: (projectId: string, eventId: string) => void;
  // Public web view: nothing to edit or open.
  readOnly?: boolean;
}) => {
  const { t, lang } = useI18n();
  const calendarName = new Map(calendars.map((c) => [c.id, c.name]));
  return (
    <Modal
      open={date !== null}
      title={date ? formatDay(date, lang) : ''}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('close')}
          </Button>
          {canAdd && !readOnly && date && (
            <Button onClick={() => onAdd(date)}>
              <Plus size={16} />
              {t('addCalendarEvent')}
            </Button>
          )}
        </>
      }
    >
      {entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-secondary">{t('noCalendarEntriesOnDay')}</p>
      ) : (
        <ul className="space-y-2.5">
          {entries.map((entry) => {
            const time = timeRange(entry.start, entry.end);
            return (
              <li
                key={entry.key}
                className="relative overflow-hidden rounded-lg border border-border bg-surface py-3 pl-4 pr-3"
              >
                <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: colorOf(entry) }} />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm text-text-secondary">
                      <Clock size={13} className="flex-shrink-0" />
                      <span className="tabular-nums">{time ?? t('allDay')}</span>
                      {entry.span && (
                        <span className="text-text-tertiary">
                          · {t('dayOfDays').replace('{day}', String(entry.span.day)).replace('{days}', String(entry.span.days))}
                        </span>
                      )}
                      {entry.kind === 'event' && entry.event.repeat !== 'none' && (
                        <Repeat size={13} className="flex-shrink-0 text-text-tertiary" aria-label={t('repeats')} />
                      )}
                    </p>
                    <p className="mt-0.5 font-semibold leading-snug break-words">{entry.name}</p>
                    <p className="mt-0.5 text-xs text-text-tertiary">
                      {entry.kind === 'rehearsal'
                        ? `${t('rehearsal')} · ${entry.project.name}`
                        : `${t('manualEvents')} · ${calendarName.get(entry.event.calendar_id) ?? ''}`}
                    </p>
                  </div>
                  {readOnly ? null : entry.kind === 'rehearsal' ? (
                    <Button
                      variant="secondary"
                      className="flex-shrink-0 !px-3 !py-1.5 text-xs"
                      onClick={() => onOpenRehearsal(entry.project.id, entry.event.id)}
                    >
                      {t('openRehearsal')}
                    </Button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onEdit(entry)}
                      aria-label={t('edit')}
                      title={t('edit')}
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover hover:text-text"
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                </div>
                {(entry.location || entry.notes || entry.link) && (
                  <div className="mt-2 space-y-1 text-sm text-text-secondary">
                    {entry.location && (
                      <p className="flex items-start gap-1.5">
                        <MapPin size={14} className="mt-0.5 flex-shrink-0" />
                        <span className="break-words">{entry.location}</span>
                      </p>
                    )}
                    {entry.notes && (
                      <p className="flex items-start gap-1.5">
                        <StickyNote size={14} className="mt-0.5 flex-shrink-0" />
                        <span className="whitespace-pre-wrap break-words">{entry.notes}</span>
                      </p>
                    )}
                    {entry.link && (
                      <a
                        href={entry.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-text underline underline-offset-2 hover:text-accent"
                      >
                        <ExternalLink size={14} className="flex-shrink-0" />
                        <span className="truncate">{entry.link.replace(/^https?:\/\//, '')}</span>
                      </a>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
};

// --- Calendar: create / edit, with its projects ----------------------------------

// Default reminder choices, in minutes before the start.
const REMINDER_OPTIONS = [0, 10, 30, 60, 120, 1440, 2880, 10080];

const reminderLabel = (minutes: number, t: (key: string) => string) => {
  if (minutes === 0) return t('reminderAtStart');
  if (minutes < 60) return t('reminderMinutes').replace('{n}', String(minutes));
  if (minutes < 1440) return t(minutes === 60 ? 'reminderHour' : 'reminderHours').replace('{n}', String(minutes / 60));
  if (minutes < 10080) return t(minutes === 1440 ? 'reminderDay' : 'reminderDays').replace('{n}', String(minutes / 1440));
  return t('reminderWeek');
};

export const CalendarFormModal = ({
  open,
  calendar,
  data,
  onClose,
  onSaved,
}: {
  open: boolean;
  calendar: Calendar | null;
  data: CalendarData;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [color, setColor] = useState(GROUP_PALETTE[0]);
  const [reminder, setReminder] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const assigned = useMemo(
    () => new Set(data.calendarProjects.filter((cp) => cp.calendar_id === calendar?.id).map((cp) => cp.project_id)),
    [data.calendarProjects, calendar?.id],
  );

  useEffect(() => {
    if (!open) return;
    setName(calendar?.name ?? '');
    setColor(calendar?.color ?? paletteColor(data.calendars.length));
    setReminder(calendar?.reminder_minutes == null ? '' : String(calendar.reminder_minutes));
    setSelected(new Set(assigned));
    setQuery('');
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, calendar?.id]);

  // Active projects first, archived ones after; filtered by the search.
  const projects = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...data.projects]
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => Number(a.status === 'archived') - Number(b.status === 'archived') || a.name.localeCompare(b.name));
  }, [data.projects, query]);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const fail = (message: string) => {
    setSaving(false);
    setError(message || t('saveFailed'));
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    let id = calendar?.id;
    const reminder_minutes = reminder === '' ? null : Number(reminder);
    if (calendar) {
      const { error: updateError } = await api
        .from('calendars')
        .update({ name: name.trim(), color, reminder_minutes })
        .eq('id', calendar.id);
      if (updateError) return fail(updateError.message);
    } else {
      const { data: created, error: insertError } = await api
        .from('calendars')
        .insert({ name: name.trim(), color, reminder_minutes, position: data.calendars.length })
        .select()
        .single();
      if (insertError || !created) return fail(insertError?.message ?? '');
      id = (created as Calendar).id;
    }
    const toAdd = [...selected].filter((p) => !assigned.has(p));
    const toRemove = [...assigned].filter((p) => !selected.has(p));
    if (toAdd.length) {
      const { error: addError } = await api
        .from('calendar_projects')
        .insert(toAdd.map((project_id) => ({ calendar_id: id, project_id })));
      if (addError) return fail(addError.message);
    }
    if (toRemove.length) {
      const { error: removeError } = await api
        .from('calendar_projects')
        .delete()
        .eq('calendar_id', id)
        .in('project_id', toRemove);
      if (removeError) return fail(removeError.message);
    }
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal
      open={open}
      title={calendar ? t('editCalendar') : t('newCalendar')}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" form="calendar-form" disabled={saving || !name.trim()}>
            {saving ? t('loading') : calendar ? t('save') : t('create')}
          </Button>
        </>
      }
    >
      <form id="calendar-form" onSubmit={save} className="space-y-5">
        <Input
          label={t('name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('calendarNamePlaceholder')}
          maxLength={120}
          required
          autoFocus
        />

        <div>
          <p className="mb-2 text-sm font-medium">{t('groupColor')}</p>
          <div className="flex flex-wrap gap-2">
            {GROUP_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                aria-pressed={color.toLowerCase() === c}
                onClick={() => setColor(c)}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition-shadow',
                  color.toLowerCase() === c && 'ring-2 ring-black',
                )}
                style={{ backgroundColor: c }}
              >
                {color.toLowerCase() === c && <Check size={15} className="text-white" />}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Select label={t('calendarReminder')} value={reminder} onChange={(e) => setReminder(e.target.value)}>
            <option value="">{t('reminderNone')}</option>
            {REMINDER_OPTIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {reminderLabel(minutes, t)}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-text-tertiary">
            <Bell size={13} className="mt-px flex-shrink-0" />
            {t('calendarReminderHint')}
          </p>
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium">{t('projects')}</p>
            <p className="text-xs text-text-tertiary">{t('selectedCount').replace('{n}', String(selected.size))}</p>
          </div>
          <p className="mb-2 text-sm text-text-secondary">{t('calendarProjectsHint')}</p>
          <div className="rounded-md border border-border">
            <label className="flex items-center gap-2 border-b border-border px-3 py-2 text-text-secondary">
              <Search size={15} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('search')}
                aria-label={t('search')}
                className="w-full bg-transparent text-sm text-text placeholder:text-text-tertiary focus:outline-none"
              />
            </label>
            <ul className="max-h-64 overflow-y-auto py-1">
              {projects.length === 0 && <li className="px-3 py-3 text-sm text-text-tertiary">{t('noProjects')}</li>}
              {projects.map((p) => (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-muted">
                    <input
                      type="checkbox"
                      className="h-4 w-4 flex-shrink-0 accent-black"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                    {p.status === 'archived' && (
                      <span className="rounded-md border border-border px-1.5 py-0.5 text-xs text-text-tertiary">
                        {t('archived')}
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {error && <p className="text-sm text-danger-strong">{error}</p>}
      </form>
    </Modal>
  );
};

// --- Event: create / edit ----------------------------------------------------------

const blankEvent = {
  name: '',
  date: '',
  end_date: '',
  start_time: '',
  end_time: '',
  location: '',
  link: '',
  notes: '',
  repeat: 'none' as CalendarRepeat,
  repeat_interval: '1',
  repeat_until: '',
};

const REPEATS: CalendarRepeat[] = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

// One occurrence of a repeating event, edited on its own ("only this one").
export interface OccurrenceTarget {
  date: string; // the first day it originally falls on
  exception: CalendarEventException | null;
}

export const CalendarEventModal = ({
  open,
  event,
  occurrence = null,
  defaults,
  calendars,
  onClose,
  onSaved,
}: {
  open: boolean;
  event: CalendarEvent | null;
  // Set: edit only this occurrence of `event` (a repeating one).
  occurrence?: OccurrenceTarget | null;
  defaults: { calendarId: string | null; date: string | null };
  calendars: Calendar[];
  onClose: () => void;
  onSaved: () => void;
}) => {
  const { t } = useI18n();
  const [form, setForm] = useState(blankEvent);
  const [calendarId, setCalendarId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const single = Boolean(event && occurrence);
  const exception = occurrence?.exception ?? null;

  useEffect(() => {
    if (!open) return;
    // One occurrence starts from its own change, else from the series moved
    // to that day.
    const source =
      event && occurrence
        ? (exception ?? { ...event, date: occurrence.date, end_date: shiftedEnd(event, occurrence.date) })
        : null;
    setForm(
      source
        ? {
            ...blankEvent,
            name: source.name,
            date: source.date,
            end_date: source.end_date ?? '',
            start_time: source.start_time ?? '',
            end_time: source.end_time ?? '',
            location: source.location ?? '',
            link: source.link ?? '',
            notes: source.notes ?? '',
          }
        : event
        ? {
            name: event.name,
            date: event.date,
            end_date: event.end_date ?? '',
            repeat: event.repeat ?? 'none',
            repeat_interval: String(event.repeat_interval ?? 1),
            repeat_until: event.repeat_until ?? '',
            start_time: event.start_time ?? '',
            end_time: event.end_time ?? '',
            location: event.location ?? '',
            link: event.link ?? '',
            notes: event.notes ?? '',
          }
        : { ...blankEvent, date: defaults.date ?? '' },
    );
    setCalendarId(event?.calendar_id ?? defaults.calendarId ?? calendars[0]?.id ?? '');
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.id, occurrence?.date]);

  const update = (patch: Partial<typeof blankEvent>) => setForm((f) => ({ ...f, ...patch }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const rawLink = form.link.trim();
    // "example.com" is taken as a web address.
    const link = rawLink && !/^https?:\/\//i.test(rawLink) ? `https://${rawLink}` : rawLink;
    setSaving(true);
    setError('');
    const interval = Math.min(99, Math.max(1, Math.round(Number(form.repeat_interval)) || 1));
    if (event && occurrence) {
      const values = {
        cancelled: false,
        name: form.name.trim(),
        date: form.date,
        end_date: form.end_date && form.end_date > form.date ? form.end_date : null,
        start_time: form.start_time || null,
        end_time: form.start_time && form.end_time ? form.end_time : null,
        location: form.location.trim() || null,
        link: link || null,
        notes: form.notes.trim() || null,
      };
      const { error: saveError } = exception
        ? await api.from('calendar_event_exceptions').update(values).eq('id', exception.id)
        : await api
            .from('calendar_event_exceptions')
            .insert({ event_id: event.id, occurrence_date: occurrence.date, ...values });
      setSaving(false);
      if (saveError) {
        setError(saveError.message || t('saveFailed'));
        return;
      }
      onSaved();
      onClose();
      return;
    }
    const payload = {
      calendar_id: calendarId,
      name: form.name.trim(),
      date: form.date,
      end_date: form.end_date && form.end_date > form.date ? form.end_date : null,
      repeat: form.repeat,
      repeat_interval: form.repeat === 'none' ? 1 : interval,
      repeat_until: form.repeat !== 'none' && form.repeat_until >= form.date ? form.repeat_until : null,
      start_time: form.start_time || null,
      end_time: form.start_time && form.end_time ? form.end_time : null,
      location: form.location.trim() || null,
      link: link || null,
      notes: form.notes.trim() || null,
    };
    const { error: saveError } = event
      ? await api.from('calendar_events').update(payload).eq('id', event.id)
      : await api.from('calendar_events').insert(payload);
    setSaving(false);
    if (saveError) {
      setError(saveError.message || t('saveFailed'));
      return;
    }
    // A series that now falls on other days drops its single changes: they
    // were tied to dates it no longer has.
    if (
      event &&
      event.repeat !== 'none' &&
      (payload.date !== event.date ||
        payload.repeat !== event.repeat ||
        payload.repeat_interval !== event.repeat_interval)
    ) {
      await api.from('calendar_event_exceptions').delete().eq('event_id', event.id);
    }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!event) return;
    setConfirmDelete(false);
    if (occurrence) {
      // Cancelling one occurrence keeps the series.
      if (exception) {
        await api.from('calendar_event_exceptions').update({ cancelled: true }).eq('id', exception.id);
      } else {
        await api.from('calendar_event_exceptions').insert({
          event_id: event.id,
          occurrence_date: occurrence.date,
          cancelled: true,
          name: event.name,
          date: occurrence.date,
          end_date: shiftedEnd(event, occurrence.date),
          start_time: event.start_time,
          end_time: event.end_time,
          location: event.location,
          notes: event.notes,
          link: event.link,
        });
      }
    } else {
      await api.from('calendar_events').delete().eq('id', event.id);
    }
    onSaved();
    onClose();
  };

  // Back to what the series says for this day.
  const resetOccurrence = async () => {
    if (!exception) return;
    await api.from('calendar_event_exceptions').delete().eq('id', exception.id);
    onSaved();
    onClose();
  };

  return (
    <>
      <Modal
        open={open}
        title={single ? t('editOccurrence') : event ? t('editCalendarEvent') : t('addCalendarEvent')}
        onClose={onClose}
        size="lg"
        footer={
          <>
            {event && (
              <div className="mr-auto flex gap-2">
                <Button variant="secondary" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={15} />
                  {single ? t('cancelOccurrence') : t('delete')}
                </Button>
                {single && exception && (
                  <Button variant="secondary" onClick={() => void resetOccurrence()}>
                    <Undo2 size={15} />
                    {t('resetOccurrence')}
                  </Button>
                )}
              </div>
            )}
            <Button variant="secondary" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              form="calendar-event-form"
              disabled={
                saving ||
                !form.name.trim() ||
                !form.date ||
                !calendarId ||
                Boolean(form.end_date && form.end_date < form.date)
              }
            >
              {saving ? t('loading') : event ? t('save') : t('create')}
            </Button>
          </>
        }
      >
        <form id="calendar-event-form" onSubmit={save} className="space-y-4">
          {single ? (
            <p className="flex items-start gap-2 rounded-md bg-surface-muted px-3 py-2 text-sm text-text-secondary">
              <Repeat size={15} className="mt-0.5 flex-shrink-0" />
              {t('editOccurrenceHint')}
            </p>
          ) : (
            <Select label={t('calendar')} value={calendarId} onChange={(e) => setCalendarId(e.target.value)} required>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
          <Input
            label={t('name')}
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder={t('calendarEventNamePlaceholder')}
            maxLength={200}
            required
            autoFocus
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <DatePicker label={t('date')} value={form.date || null} onChange={(date) => update({ date })} />
            <DatePicker
              label={`${t('endDate')} (${t('optional')})`}
              value={form.end_date || null}
              onChange={(end_date) => update({ end_date })}
            />
          </div>
          {form.end_date && form.date && form.end_date < form.date && (
            <p className="-mt-2 text-xs text-danger-strong">{t('endDateBeforeStart')}</p>
          )}
          <div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="time"
                label={`${t('startTime')} (${t('optional')})`}
                value={form.start_time}
                onChange={(e) => update({ start_time: e.target.value })}
              />
              <Input
                type="time"
                label={`${t('endTime')} (${t('optional')})`}
                value={form.end_time}
                disabled={!form.start_time}
                onChange={(e) => update({ end_time: e.target.value })}
              />
            </div>
            <p className="mt-1.5 text-xs text-text-tertiary">{t('calendarEventTimeHint')}</p>
          </div>
          {!single && (
          <div className="space-y-3 rounded-md border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
              <Select
                label={t('repeats')}
                value={form.repeat}
                onChange={(e) => update({ repeat: e.target.value as CalendarRepeat })}
              >
                {REPEATS.map((r) => (
                  <option key={r} value={r}>
                    {t(`repeat_${r}`)}
                  </option>
                ))}
              </Select>
              {form.repeat !== 'none' && (
                <Input
                  type="number"
                  min={1}
                  max={99}
                  label={t('repeatEvery')}
                  value={form.repeat_interval}
                  onChange={(e) => update({ repeat_interval: e.target.value })}
                />
              )}
            </div>
            {form.repeat !== 'none' && (
              <>
                <DatePicker
                  label={`${t('repeatUntil')} (${t('optional')})`}
                  value={form.repeat_until || null}
                  onChange={(repeat_until) => update({ repeat_until })}
                />
                <p className="text-xs text-text-tertiary">{t('repeatHint')}</p>
              </>
            )}
          </div>
          )}
          <Input
            label={`${t('eventLocation')} (${t('optional')})`}
            placeholder={t('eventLocationPlaceholder')}
            maxLength={200}
            value={form.location}
            onChange={(e) => update({ location: e.target.value })}
          />
          <Input
            type="text"
            inputMode="url"
            label={`${t('link')} (${t('optional')})`}
            placeholder="https://…"
            maxLength={2000}
            value={form.link}
            onChange={(e) => update({ link: e.target.value })}
          />
          <Textarea
            label={`${t('notes')} (${t('optional')})`}
            rows={3}
            maxLength={2000}
            value={form.notes}
            onChange={(e) => update({ notes: e.target.value })}
          />
          {error && <p className="text-sm text-danger-strong">{error}</p>}
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        title={single ? t('cancelOccurrence') : t('delete')}
        message={
          single
            ? t('confirmCancelOccurrence')
            : event && event.repeat !== 'none'
              ? t('confirmDeleteSeries')
              : t('confirmDeleteCalendarEvent')
        }
        confirmLabel={single ? t('cancelOccurrence') : t('delete')}
        destructive
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
};
