import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BedDouble, CalendarDays, ChevronRight, ExternalLink, Loader2, MapPin, Pencil, Send, Undo2, UsersRound } from 'lucide-react';
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

  const startEditing = () =>
    setEditing({
      title: weekend.title,
      starts_on: weekend.starts_on ?? '',
      ends_on: weekend.ends_on ?? '',
      location: weekend.location,
      description: weekend.description,
      signup_url: weekend.signup_url ?? '',
    });

  const signup = weekend.signup_url && /^https?:\/\//i.test(weekend.signup_url) && weekend.details_published && !weekend.archived ? weekend.signup_url : null;
  const roomsCta = !canManage && weekend.me.confirmed && weekend.rooms_status !== 'hidden';
  const facts = [
    dates && { icon: CalendarDays, text: dates },
    weekend.location && { icon: MapPin, text: weekend.location },
  ].filter((f): f is { icon: typeof MapPin; text: string } => Boolean(f));

  return (
    <div className="max-w-5xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="break-words text-xl font-bold sm:text-2xl">{weekend.title}</h1>
          {canManage && <ReleasePill released={weekend.details_published && !weekend.archived} />}
        </div>
        {canManage && (
          <div className="flex flex-shrink-0 flex-wrap gap-2">
            {!editing && (
              <Button variant="secondary" onClick={startEditing}>
                <Pencil size={16} />
                {t('edit')}
              </Button>
            )}
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        {/* Phones: the facts first; wide screens: beside the text. */}
        <aside className="space-y-3 lg:order-last">
          {(facts.length > 0 || signup || roomsCta || (canManage && weekend.counts)) && (
            <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
              {facts.map(({ icon: Icon, text }) => (
                <p key={text} className="flex items-start gap-2.5 text-sm">
                  <Icon size={16} className="mt-0.5 flex-shrink-0 text-text-tertiary" />
                  <span className="min-w-0 break-words">{text}</span>
                </p>
              ))}
              {canManage && weekend.counts && (
                <p className="flex items-start gap-2.5 text-sm text-text-secondary">
                  <UsersRound size={16} className="mt-0.5 flex-shrink-0 text-text-tertiary" />
                  <span>
                    {t('weekendCounts')
                      .replace('{confirmed}', String(weekend.counts.confirmed ?? 0))
                      .replace('{all}', String(weekend.counts.participants ?? 0))
                      .replace('{rooms}', String(weekend.counts.rooms ?? 0))}
                  </span>
                </p>
              )}
              {signup && (
                <a href={signup} target="_blank" rel="noopener noreferrer" className="block">
                  <Button className="w-full">
                    <ExternalLink size={16} />
                    {t('weekendSignup')}
                  </Button>
                </a>
              )}
              {canManage && weekend.signup_url && (
                <p className="truncate text-xs text-text-tertiary" title={weekend.signup_url}>
                  {t('weekendSignupLink')}: {weekend.signup_url}
                </p>
              )}
            </div>
          )}
          {roomsCta && (
            <Link to="../rooms" relative="path" className="flex items-center gap-3 rounded-2xl border border-accent/50 bg-accent/10 px-4 py-3 text-sm hover:shadow-sm">
              <BedDouble size={18} className="flex-shrink-0" />
              <span className="min-w-0 flex-1">{weekend.me.room_id || weekend.rooms_status === 'locked' ? t('weekendYourRoom') : t('weekendChooseRoomCta')}</span>
              <ChevronRight size={16} className="flex-shrink-0 text-text-tertiary" />
            </Link>
          )}
        </aside>

        {editing ? (
          <Card className="space-y-4 max-sm:p-4">
            <Input label={t('title')} value={editing.title} maxLength={200} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input type="date" label={t('weekendFrom')} value={editing.starts_on} onChange={(e) => setEditing({ ...editing, starts_on: e.target.value })} />
              <Input type="date" label={t('weekendTo')} value={editing.ends_on} min={editing.starts_on || undefined} onChange={(e) => setEditing({ ...editing, ends_on: e.target.value })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={t('eventLocation')} value={editing.location} maxLength={300} onChange={(e) => setEditing({ ...editing, location: e.target.value })} />
              <Input
                type="url"
                label={`${t('weekendSignupLink')} (${t('optional')})`}
                placeholder="https://"
                value={editing.signup_url}
                onChange={(e) => setEditing({ ...editing, signup_url: e.target.value })}
              />
            </div>
            <MarkdownEditor
              id="weekend-description"
              label={t('concertDescription')}
              value={editing.description}
              onChange={(description) => setEditing({ ...editing, description })}
              minHeight={180}
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
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('concertAbout')}</h2>
            {weekend.description ? (
              <Markdown source={weekend.description} className="mt-2 space-y-2 break-words text-sm" />
            ) : (
              <p className="mt-2 text-sm text-text-tertiary">{t('concertNoDescription')}</p>
            )}
          </Card>
        )}
      </div>
      <Toast toast={toast.toast} onClose={toast.hide} />
    </div>
  );
};
