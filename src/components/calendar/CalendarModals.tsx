import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Check,
  Clock,
  Copy,
  ExternalLink,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  StickyNote,
  Trash2,
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
import { feedUrls, formatDay, timeRange, type CalendarData, type CalendarEntry } from '@/lib/calendar';
import type { Calendar, CalendarEvent } from '@/types';

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
}: {
  date: string | null;
  entries: CalendarEntry[];
  calendars: Calendar[];
  colorOf: (entry: CalendarEntry) => string;
  canAdd: boolean;
  onClose: () => void;
  onAdd: (date: string) => void;
  onEdit: (event: CalendarEvent) => void;
  onOpenRehearsal: (projectId: string, eventId: string) => void;
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
          {canAdd && date && (
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
                    </p>
                    <p className="mt-0.5 font-semibold leading-snug break-words">{entry.name}</p>
                    <p className="mt-0.5 text-xs text-text-tertiary">
                      {entry.kind === 'rehearsal'
                        ? `${t('rehearsal')} · ${entry.project.name}`
                        : `${t('calendarEventsEntry')} · ${calendarName.get(entry.event.calendar_id) ?? ''}`}
                    </p>
                  </div>
                  {entry.kind === 'rehearsal' ? (
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
                      onClick={() => onEdit(entry.event)}
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
    if (calendar) {
      const { error: updateError } = await api.from('calendars').update({ name: name.trim(), color }).eq('id', calendar.id);
      if (updateError) return fail(updateError.message);
    } else {
      const { data: created, error: insertError } = await api
        .from('calendars')
        .insert({ name: name.trim(), color, position: data.calendars.length })
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

const blankEvent = { name: '', date: '', start_time: '', end_time: '', location: '', link: '', notes: '' };

export const CalendarEventModal = ({
  open,
  event,
  defaults,
  calendars,
  onClose,
  onSaved,
}: {
  open: boolean;
  event: CalendarEvent | null;
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

  useEffect(() => {
    if (!open) return;
    setForm(
      event
        ? {
            name: event.name,
            date: event.date,
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
  }, [open, event?.id]);

  const update = (patch: Partial<typeof blankEvent>) => setForm((f) => ({ ...f, ...patch }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const rawLink = form.link.trim();
    // "example.com" is taken as a web address.
    const link = rawLink && !/^https?:\/\//i.test(rawLink) ? `https://${rawLink}` : rawLink;
    setSaving(true);
    setError('');
    const payload = {
      calendar_id: calendarId,
      name: form.name.trim(),
      date: form.date,
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
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!event) return;
    setConfirmDelete(false);
    await api.from('calendar_events').delete().eq('id', event.id);
    onSaved();
    onClose();
  };

  return (
    <>
      <Modal
        open={open}
        title={event ? t('editCalendarEvent') : t('addCalendarEvent')}
        onClose={onClose}
        size="lg"
        footer={
          <>
            {event && (
              <Button variant="secondary" className="mr-auto" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={15} />
                {t('delete')}
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              form="calendar-event-form"
              disabled={saving || !form.name.trim() || !form.date || !calendarId}
            >
              {saving ? t('loading') : event ? t('save') : t('create')}
            </Button>
          </>
        }
      >
        <form id="calendar-event-form" onSubmit={save} className="space-y-4">
          <Select label={t('calendar')} value={calendarId} onChange={(e) => setCalendarId(e.target.value)} required>
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input
            label={t('name')}
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder={t('calendarEventNamePlaceholder')}
            maxLength={200}
            required
            autoFocus
          />
          <DatePicker label={t('date')} value={form.date || null} onChange={(date) => update({ date })} />
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
        title={t('delete')}
        message={t('confirmDeleteCalendarEvent')}
        confirmLabel={t('delete')}
        destructive
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
};

// --- Subscription link ---------------------------------------------------------------

export const SubscribeModal = ({
  calendar,
  onClose,
  onRenewed,
}: {
  calendar: Calendar | null;
  onClose: () => void;
  onRenewed: () => void;
}) => {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [confirmRenew, setConfirmRenew] = useState(false);

  useEffect(() => setCopied(false), [calendar?.id, calendar?.feed_token]);

  if (!calendar) return null;
  const urls = feedUrls(calendar.feed_token);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(urls.https);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const renew = async () => {
    setConfirmRenew(false);
    await api.from('calendars').update({ feed_token: crypto.randomUUID() }).eq('id', calendar.id);
    onRenewed();
  };

  return (
    <>
      <Modal open title={`${t('subscribeCalendar')}: ${calendar.name}`} onClose={onClose} size="lg">
        <p className="text-sm text-text-secondary">{t('subscribeCalendarHint')}</p>
        <div className="flex gap-2">
          <input
            readOnly
            value={urls.https}
            onFocus={(e) => e.target.select()}
            aria-label={t('subscribeLink')}
            className="min-w-0 flex-1 rounded-md border border-border bg-surface-subtle px-3 py-2 font-mono text-xs text-text-secondary focus:border-black focus:outline-none"
          />
          <Button variant="secondary" onClick={copy} className="flex-shrink-0">
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? t('copied') : t('copyLink')}
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <a
            href={urls.google}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-surface-muted"
          >
            <ExternalLink size={15} />
            {t('openInGoogleCalendar')}
          </a>
          <a
            href={urls.webcal}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-surface-muted"
          >
            <ExternalLink size={15} />
            {t('openInAppleCalendar')}
          </a>
        </div>
        <p className="text-xs text-text-tertiary">{t('subscribeRefreshHint')}</p>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-sm text-text-secondary">{t('renewCalendarLinkHint')}</p>
          <Button variant="secondary" onClick={() => setConfirmRenew(true)} className="flex-shrink-0">
            <RefreshCw size={15} />
            {t('renewLink')}
          </Button>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmRenew}
        title={t('renewLink')}
        message={t('renewCalendarLinkConfirm')}
        confirmLabel={t('renewLink')}
        destructive
        onConfirm={renew}
        onCancel={() => setConfirmRenew(false)}
      />
    </>
  );
};
