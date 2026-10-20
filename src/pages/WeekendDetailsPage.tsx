import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BedDouble, ExternalLink, Loader2, Pencil, Send, Undo2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Input } from '@/components/Input';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { ReleasePill } from '@/components/WeekendRelease';
import { Toast, useToast } from '@/components/Toast';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Markdown } from '@/lib/markdown';
import { useWeekendContext, weekendDates } from '@/lib/weekends';

// "Details": the weekend's general information — what participants see once
// the details are released (with the external sign-up link) — and its
// managers' editing and releasing (independent of the rooms).
export const WeekendDetailsPage = () => {
  const { t, lang } = useI18n();
  const { weekend, canManage, reloadWeekend, reloadNav } = useWeekendContext();
  const [editing, setEditing] = useState<null | {
    title: string;
    starts_on: string;
    ends_on: string;
    location: string;
    description: string;
    signup_url: string;
  }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

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

  const release = async (published: boolean) => {
    if (await patch({ details_published: published })) {
      toast.show(t(published ? 'weekendDetailsReleasedToast' : 'weekendDetailsWithdrawnToast'), () => void patch({ details_published: !published }));
    }
  };

  const save = async () => {
    if (!editing || !editing.title.trim()) return;
    const ok = await patch({
      title: editing.title.trim(),
      starts_on: editing.starts_on || null,
      ends_on: editing.ends_on || null,
      location: editing.location.trim(),
      description: editing.description.trim(),
      signup_url: editing.signup_url.trim() || null,
    });
    if (ok) setEditing(null);
  };

  const dates = weekendDates(weekend, lang);

  return (
    <div className="max-w-3xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="break-words text-xl font-bold sm:text-2xl">{weekend.title}</h1>
            {canManage && <ReleasePill released={weekend.details_published && !weekend.archived} />}
          </div>
          <p className="mt-1 text-sm text-text-secondary">{[dates, weekend.location].filter(Boolean).join(' · ')}</p>
        </div>
        {canManage && (
          <div className="flex flex-shrink-0 flex-wrap gap-2">
            {weekend.details_published ? (
              <Button variant="secondary" disabled={busy} onClick={() => void release(false)}>
                <Undo2 size={16} />
                {t('weekendDetailsWithdraw')}
              </Button>
            ) : (
              <Button disabled={busy || weekend.archived} onClick={() => void release(true)}>
                <Send size={16} />
                {t('weekendDetailsRelease')}
              </Button>
            )}
          </div>
        )}
      </header>
      {error && <p className="text-sm text-danger">{error}</p>}

      {weekend.signup_url && /^https?:\/\//i.test(weekend.signup_url) && weekend.details_published && !weekend.archived && (
        <a href={weekend.signup_url} target="_blank" rel="noopener noreferrer" className="inline-block">
          <Button>
            <ExternalLink size={16} />
            {t('weekendSignup')}
          </Button>
        </a>
      )}

      {!canManage && weekend.me.confirmed && weekend.rooms_status !== 'hidden' && (
        <Link
          to="rooms"
          className="flex items-center gap-3 rounded-2xl border border-accent/50 bg-accent/10 px-4 py-3 text-sm hover:shadow-sm"
        >
          <BedDouble size={18} />
          <span className="flex-1">{weekend.me.room_id || weekend.rooms_status === 'locked' ? t('weekendYourRoom') : t('weekendChooseRoomCta')}</span>
        </Link>
      )}

      {editing ? (
        <Card className="space-y-4 max-sm:p-4">
          <Input label={t('title')} value={editing.title} maxLength={200} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input type="date" label={t('weekendFrom')} value={editing.starts_on} onChange={(e) => setEditing({ ...editing, starts_on: e.target.value })} />
            <Input type="date" label={t('weekendTo')} value={editing.ends_on} min={editing.starts_on || undefined} onChange={(e) => setEditing({ ...editing, ends_on: e.target.value })} />
          </div>
          <Input label={t('eventLocation')} value={editing.location} maxLength={300} onChange={(e) => setEditing({ ...editing, location: e.target.value })} />
          <Input
            type="url"
            label={`${t('weekendSignupLink')} (${t('optional')})`}
            placeholder="https://"
            value={editing.signup_url}
            onChange={(e) => setEditing({ ...editing, signup_url: e.target.value })}
          />
          <MarkdownEditor
            id="weekend-description"
            label={t('concertDescription')}
            value={editing.description}
            onChange={(description) => setEditing({ ...editing, description })}
            minHeight={140}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {t('cancel')}
            </Button>
            <Button onClick={() => void save()} disabled={busy || !editing.title.trim()}>
              {busy && <Loader2 size={15} className="animate-spin" />}
              {t('save')}
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="max-sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('concertAbout')}</h2>
            {canManage && (
              <Button
                variant="secondary"
                className="h-8 px-3"
                onClick={() =>
                  setEditing({
                    title: weekend.title,
                    starts_on: weekend.starts_on ?? '',
                    ends_on: weekend.ends_on ?? '',
                    location: weekend.location,
                    description: weekend.description,
                    signup_url: weekend.signup_url ?? '',
                  })
                }
              >
                <Pencil size={14} />
                {t('edit')}
              </Button>
            )}
          </div>
          {weekend.description ? (
            <Markdown source={weekend.description} className="mt-2 space-y-2 break-words text-sm" />
          ) : (
            <p className="mt-2 text-sm text-text-tertiary">{t('concertNoDescription')}</p>
          )}
          {canManage && weekend.signup_url && (
            <p className="mt-3 truncate border-t border-border pt-2 text-xs text-text-tertiary">
              {t('weekendSignupLink')}: {weekend.signup_url}
            </p>
          )}
        </Card>
      )}

      {canManage && weekend.counts && (
        <p className="text-sm text-text-secondary">
          {t('weekendCounts')
            .replace('{confirmed}', String(weekend.counts.confirmed ?? 0))
            .replace('{all}', String(weekend.counts.participants ?? 0))
            .replace('{rooms}', String(weekend.counts.rooms ?? 0))}
          {!weekend.details_published && ` · ${t('weekendDraftHint')}`}
        </p>
      )}
      <Toast toast={toast.toast} onClose={toast.hide} />
    </div>
  );
};
