import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Music2, Plus } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { HeaderAction } from '@/components/HeaderAction';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { PageSpinner } from '@/components/Spinner';
import { EventWhen } from '@/components/EventWhen';
import { LifecycleBadge } from '@/components/Lifecycle';
import { ConcertFields, blankConcert, concertPayload, type ConcertValues } from '@/components/ConcertForm';
import { useProjectContext } from '@/layouts/projectContext';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { localeOf } from '@shared/languages';
import { loadConcerts, sortConcerts } from '@/lib/concerts';
import { track } from '@/lib/analytics';
import type { Concert } from '@/types';

// "Konzert": the project's concerts — the next one on top, then the later
// ones, then past ones (they stay until archived by hand). Participants see
// published ones only; managers also drafts and, folded away, the archive.
export const ConcertsPage = () => {
  const { t } = useI18n();
  const { project, canManage } = useProjectContext();
  const navigate = useNavigate();
  const [concerts, setConcerts] = useState<Concert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ConcertValues>(blankConcert);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => setConcerts(await loadConcerts(project.id)), [project.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    setError(null);
    const { data, error: insertError } = await api
      .from('concerts')
      .insert({ project_id: project.id, ...concertPayload(form) })
      .select('id')
      .single();
    setSaving(false);
    if (insertError || !data) return setError(insertError?.message ?? t('saveFailed'));
    track('concert-create');
    navigate(`/projects/${project.id}/concerts/${(data as { id: string }).id}`);
  };

  if (!concerts) return <PageSpinner />;

  const active = concerts.filter((c) => !c.archived);
  const archived = concerts.filter((c) => c.archived);
  const { upcoming, past } = sortConcerts(active);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={t('concerts')}
        inlineActions
        actions={
          canManage ? (
            <HeaderAction
              icon={Plus}
              label={t('newConcert')}
              onClick={() => {
                setForm(blankConcert);
                setError(null);
                setCreating(true);
              }}
            />
          ) : undefined
        }
      />

      {active.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-border-strong px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-text-secondary">
            <Music2 size={22} />
          </span>
          <p className="mt-3 font-semibold">{t('noConcerts')}</p>
          <p className="mt-1 text-sm text-text-secondary">{canManage ? t('noConcertsHintManager') : t('noConcertsHint')}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {upcoming.length > 0 && (
            <section>
              <SectionLabel>{t('concertsUpcoming')}</SectionLabel>
              <ul className="space-y-2">
                {upcoming.map((c, i) => (
                  <ConcertCard key={c.id} concert={c} next={i === 0 && Boolean(c.date)} manage={canManage} />
                ))}
              </ul>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <SectionLabel>{t('concertsPast')}</SectionLabel>
              <ul className="space-y-2">
                {past.map((c) => (
                  <ConcertCard key={c.id} concert={c} manage={canManage} past />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {canManage && archived.length > 0 && (
        <details className="mt-8 rounded-2xl border border-border bg-surface px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-text-secondary">
            {t('lifecycleArchived')} ({archived.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {archived.map((c) => (
              <ConcertCard key={c.id} concert={c} manage />
            ))}
          </ul>
        </details>
      )}

      <Modal
        open={creating}
        title={t('newConcert')}
        onClose={() => setCreating(false)}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" form="concert-form" disabled={saving || !form.title.trim()}>
              {saving ? t('loading') : t('create')}
            </Button>
          </>
        }
      >
        <form id="concert-form" onSubmit={create} className="space-y-4">
          <ConcertFields value={form} onChange={setForm} compact />
          <p className="text-xs text-text-tertiary">{t('concertStartsAsDraft')}</p>
          {error && <p className="text-sm text-danger">{error}</p>}
        </form>
      </Modal>
    </div>
  );
};

const SectionLabel = ({ children }: { children: string }) => (
  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">{children}</h2>
);

// One concert: a date tile, its title, when and where, and its state.
const ConcertCard = ({
  concert: c,
  next = false,
  past = false,
  manage,
}: {
  concert: Concert;
  next?: boolean;
  past?: boolean;
  manage: boolean;
}) => {
  const { t, lang } = useI18n();
  const d = c.date ? new Date(`${c.date}T00:00:00`) : null;
  return (
    <li>
      <Link
        to={c.id}
        className={cn(
          'group flex items-center gap-3 rounded-2xl border bg-surface p-3 transition-shadow duration-150 hover:shadow-sm',
          next ? 'border-accent/50' : 'border-border',
        )}
      >
        <span
          className={cn(
            'flex h-12 w-12 flex-shrink-0 flex-col items-center justify-center rounded-xl leading-none',
            next ? 'bg-accent/15 text-accent' : 'bg-surface-muted text-text-secondary',
          )}
        >
          {d ? (
            <>
              <span className="text-lg font-bold">{d.getDate()}</span>
              <span className="mt-0.5 text-[10px] font-semibold uppercase">
                {d.toLocaleDateString(localeOf(lang), { month: 'short' })}
              </span>
            </>
          ) : (
            <Music2 size={18} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn('min-w-0 truncate font-medium', past && 'text-text-secondary')}>{c.title}</span>
            {next && (
              <span className="rounded-md bg-success-soft-strong px-2 py-0.5 text-xs font-semibold text-success-strong">
                {t('nextConcert')}
              </span>
            )}
            {manage && c.status === 'draft' && <LifecycleBadge state="draft" />}
            {manage && c.archived && <LifecycleBadge state="archived" />}
          </span>
          <EventWhen
            date={c.date}
            time={c.time && c.end_time ? `${c.time}–${c.end_time}` : c.time}
            location={c.location || null}
            lang={lang}
          />
        </span>
        <ChevronRight
          size={16}
          className="flex-shrink-0 text-text-tertiary transition-transform duration-150 group-hover:translate-x-0.5"
        />
      </Link>
    </li>
  );
};
