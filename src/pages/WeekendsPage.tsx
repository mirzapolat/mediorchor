import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { BedDouble, ChevronRight, MapPin, Plus, Tent } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { HeaderAction } from '@/components/HeaderAction';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { PageSpinner } from '@/components/Spinner';
import { LifecycleBadge } from '@/components/Lifecycle';
import { useProjectContext } from '@/layouts/projectContext';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { weekendDates, type Weekend } from '@/lib/weekends';

// "Probenwochenende": the project's weekends. With just one the person may
// open, it opens right away; otherwise a plain choice. Managers create them.
export const WeekendsPage = () => {
  const { t, lang } = useI18n();
  const { project, canManage } = useProjectContext();
  const navigate = useNavigate();
  const [weekends, setWeekends] = useState<Weekend[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', starts_on: '', ends_on: '', location: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.rpc('weekend_list', { p_project_id: project.id }).then(({ data }) => setWeekends((data as Weekend[] | null) ?? []));
  }, [project.id]);

  if (!weekends) return <PageSpinner />;
  const active = weekends.filter((w) => !w.archived);
  if (!canManage && active.length === 1) return <Navigate to={active[0].id} replace />;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const { data, error: insertError } = await api
      .from('weekends')
      .insert({
        project_id: project.id,
        title: form.title.trim(),
        starts_on: form.starts_on || null,
        ends_on: form.ends_on || null,
        location: form.location.trim(),
      })
      .select('id')
      .single();
    if (insertError || !data) return setError(insertError?.message ?? t('saveFailed'));
    navigate((data as { id: string }).id);
  };

  const archived = weekends.filter((w) => w.archived);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={t('weekend')}
        inlineActions
        actions={canManage ? <HeaderAction icon={Plus} label={t('newWeekend')} onClick={() => setCreating(true)} /> : undefined}
      />
      {active.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-border-strong px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-text-secondary">
            <Tent size={22} />
          </span>
          <p className="mt-3 font-semibold">{t('noWeekends')}</p>
          <p className="mt-1 text-sm text-text-secondary">{canManage ? t('noWeekendsHintManager') : t('noWeekendsHint')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {active.map((w) => (
            <WeekendRow key={w.id} weekend={w} manage={canManage} lang={lang} />
          ))}
        </ul>
      )}
      {canManage && archived.length > 0 && (
        <details className="mt-8 rounded-2xl border border-border bg-surface px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-text-secondary">
            {t('lifecycleArchived')} ({archived.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {archived.map((w) => (
              <WeekendRow key={w.id} weekend={w} manage lang={lang} />
            ))}
          </ul>
        </details>
      )}

      <Modal
        open={creating}
        title={t('newWeekend')}
        onClose={() => setCreating(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" form="weekend-form" disabled={!form.title.trim()}>
              {t('create')}
            </Button>
          </>
        }
      >
        <form id="weekend-form" onSubmit={create} className="space-y-4">
          <Input label={t('title')} value={form.title} maxLength={200} required autoFocus onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input type="date" label={t('weekendFrom')} value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} />
            <Input type="date" label={t('weekendTo')} value={form.ends_on} min={form.starts_on || undefined} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} />
          </div>
          <Input label={`${t('eventLocation')} (${t('optional')})`} value={form.location} maxLength={300} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          <p className="text-xs text-text-tertiary">{t('weekendStartsAsDraft')}</p>
          {error && <p className="text-sm text-danger">{error}</p>}
        </form>
      </Modal>
    </div>
  );
};

const WeekendRow = ({ weekend: w, manage, lang }: { weekend: Weekend; manage: boolean; lang: Parameters<typeof weekendDates>[1] }) => {
  const { t } = useI18n();
  const dates = weekendDates(w, lang);
  return (
    <li>
      <Link to={w.id} className="group flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 transition-shadow hover:shadow-sm">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-surface-muted text-chart-3">
          <Tent size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate font-medium">{w.title}</span>
            {manage && w.archived && <LifecycleBadge state="archived" />}
            {/* Nothing released yet: a draft for participants. */}
            {manage && !w.archived && !w.details_published && w.rooms_status === 'hidden' && <LifecycleBadge state="draft" />}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-text-tertiary">
            {dates && <span>{dates}</span>}
            {w.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={12} />
                {w.location}
              </span>
            )}
            {manage && w.counts && (
              <span>{t('weekendConfirmedCount').replace('{n}', String(w.counts.confirmed ?? 0))}</span>
            )}
            {!manage && w.me.confirmed && (
              <span className="inline-flex items-center gap-1">
                <BedDouble size={12} />
                {w.me.room_id ? t('weekendRoomChosen') : t('weekendRoomOpen')}
              </span>
            )}
          </span>
        </span>
        <ChevronRight size={16} className="flex-shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
};
