import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Plus, CalendarDays, Pencil, Trash2, Clock } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { Input, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageSpinner } from '@/components/Spinner';
import { DataTable, type Column, type FilterDef } from '@/components/DataTable';
import { RowActionButton } from '@/components/RowActionButton';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useProjectContext } from '@/layouts/projectContext';
import type { Event } from '@/types';

const today = () => new Date().toISOString().slice(0, 10);

const blank = { name: '', description: '', date: '', time: '' };

export const EventsPage = () => {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [warningCounts, setWarningCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  // The next/today rehearsal is pinned + highlighted until the user resets filters.
  const [highlightNext, setHighlightNext] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Event | null>(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Event | null>(null);

  const load = useCallback(async () => {
    const [eventsResult, warningsResult] = await Promise.all([
      api
        .from('events')
        .select('*')
        .eq('project_id', project.id)
        .order('date', { ascending: true, nullsFirst: false })
        .order('time', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true }),
      api
        .from('checkin_submissions')
        .select('event_id, events!inner(project_id)')
        .eq('recognized', false)
        .eq('events.project_id', project.id),
    ]);

    const counts: Record<string, number> = {};
    for (const row of (warningsResult.data as Array<{ event_id: string }> | null) ?? []) {
      counts[row.event_id] = (counts[row.event_id] ?? 0) + 1;
    }
    setEvents((eventsResult.data as Event[]) ?? []);
    setWarningCounts(counts);
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(blank);
    setFormOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      project_id: project.id,
      name: form.name.trim(),
      description: form.description.trim() || null,
      date: form.date || null,
      time: form.time || null,
    };
    if (editing) {
      await api.from('events').update(payload).eq('id', editing.id);
    } else {
      await api.from('events').insert(payload);
    }
    setSaving(false);
    setFormOpen(false);
    await load();
  };

  const remove = async () => {
    if (!toDelete) return;
    await api.from('events').delete().eq('id', toDelete.id);
    setToDelete(null);
    await load();
  };

  // The upcoming rehearsal with the nearest date (today counts as upcoming).
  const nextEventId = useMemo(() => {
    const todayStr = today();
    const upcoming = events
      .filter((ev) => ev.date && ev.date >= todayStr)
      .sort((a, b) =>
        a.date === b.date ? (a.time ?? '').localeCompare(b.time ?? '') : (a.date ?? '').localeCompare(b.date ?? ''),
      );
    return upcoming[0]?.id ?? null;
  }, [events]);

  const highlightRowId = highlightNext ? nextEventId : null;

  if (loading) return <PageSpinner />;

  const columns: Column<Event>[] = [
    {
      id: 'name',
      header: t('eventName'),
      accessor: (ev) => ev.name,
      render: (ev) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate">{ev.name}</span>
            {highlightRowId === ev.id ? (
              <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-[#dcfce7] px-2 py-0.5 text-xs font-semibold text-[#16803b]">
                {ev.date === today() ? t('todayRehearsal') : t('nextRehearsal')}
              </span>
            ) : null}
            {(warningCounts[ev.id] ?? 0) > 0 ? (
              <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-[#fef2f2] px-2 py-1 text-xs font-semibold text-[#b91c1c]">
                <AlertTriangle size={13} />
                {warningCounts[ev.id]} {t('unrecognizedCheckIns').toLowerCase()}
              </span>
            ) : null}
          </div>
          {ev.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">{ev.description}</p>
          )}
        </div>
      ),
    },
    {
      id: 'date',
      header: t('date'),
      accessor: (ev) => ev.date,
      render: (ev) =>
        ev.date ? (
          <span className="inline-flex items-center gap-1.5 text-text-secondary">
            <CalendarDays size={14} />
            {ev.date}
          </span>
        ) : (
          <span className="text-text-secondary">—</span>
        ),
    },
    {
      id: 'time',
      header: t('time'),
      accessor: (ev) => ev.time,
      render: (ev) =>
        ev.time ? (
          <span className="inline-flex items-center gap-1.5 text-text-secondary">
            <Clock size={14} />
            {ev.time}
          </span>
        ) : (
          <span className="text-text-secondary">—</span>
        ),
    },
  ];

  const filters: FilterDef<Event>[] = [
    {
      id: 'timeframe',
      label: t('timeframe'),
      options: [
        { value: 'upcoming', label: t('upcoming') },
        { value: 'past', label: t('past') },
      ],
      predicate: (ev, v) => {
        if (!ev.date) return false;
        return v === 'upcoming' ? ev.date >= today() : ev.date < today();
      },
    },
  ];

  return (
    <>
      <PageHeader
        title={t('events')}
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} />
            {t('newEvent')}
          </Button>
        }
      />

      <DataTable
        rows={events}
        columns={columns}
        getRowId={(ev) => ev.id}
        onRowClick={(ev) => navigate(`/projects/${project.id}/events/${ev.id}`)}
        search={(ev) => `${ev.name} ${ev.description ?? ''}`}
        filters={filters}
        highlightRowId={highlightRowId}
        onClearFilters={() => setHighlightNext(false)}
        emptyMessage={t('noEvents')}
        emptyIcon={CalendarDays}
        actions={(ev) => (
          <>
            <RowActionButton
              label={t('edit')}
              onClick={() => navigate(`/projects/${project.id}/events/${ev.id}/settings`)}
            >
              <Pencil size={15} />
            </RowActionButton>
            <RowActionButton label={t('delete')} onClick={() => setToDelete(ev)}>
              <Trash2 size={15} />
            </RowActionButton>
          </>
        )}
      />

      <Modal
        open={formOpen}
        title={editing ? t('editEvent') : t('newEvent')}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" form="event-form" disabled={saving || !form.name.trim()}>
              {saving ? t('loading') : editing ? t('save') : t('create')}
            </Button>
          </>
        }
      >
        <form id="event-form" onSubmit={save} className="space-y-4">
          <Input
            label={t('eventName')}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            autoFocus
          />
          <Textarea
            label={`${t('eventDescription')} (${t('optional')})`}
            placeholder={t('eventDescriptionPlaceholder')}
            rows={2}
            maxLength={500}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              type="date"
              label={`${t('date')} (${t('optional')})`}
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
            <Input
              type="time"
              label={`${t('time')} (${t('optional')})`}
              value={form.time}
              onChange={(e) => setForm({ ...form, time: e.target.value })}
            />
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title={t('delete')}
        message={t('confirmDelete')}
        confirmLabel={t('delete')}
        destructive
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </>
  );
};
