import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, ChevronDown, Code, Copy, ExternalLink, Globe, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { feedUrls } from '@/lib/calendar';
import type { Calendar, CalendarLink } from '@/types';

// A calendar's subscription links (calendar_links): several named ones, each
// with its own token, detail level and "last fetched", renewable and
// deletable on its own. Each also opens the public web view and can be
// embedded on a website.
export const CalendarLinksModal = ({ calendar, onClose }: { calendar: Calendar | null; onClose: () => void }) => {
  const { t } = useI18n();
  const [links, setLinks] = useState<CalendarLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [toRenew, setToRenew] = useState<CalendarLink | null>(null);
  const [toDelete, setToDelete] = useState<CalendarLink | null>(null);

  const load = useCallback(async () => {
    if (!calendar) return [];
    const { data } = await api
      .from('calendar_links')
      .select('*')
      .eq('calendar_id', calendar.id)
      .order('created_at');
    const rows = (data as CalendarLink[] | null) ?? [];
    setLinks(rows);
    setLoading(false);
    return rows;
  }, [calendar]);

  useEffect(() => {
    if (!calendar) return;
    setLoading(true);
    setNewName('');
    void load().then((rows) => setOpenId(rows[0]?.id ?? null));
  }, [calendar, load]);

  if (!calendar) return null;

  const patch = async (link: CalendarLink, values: Partial<CalendarLink>) => {
    setLinks((current) => current.map((l) => (l.id === link.id ? { ...l, ...values } : l)));
    await api.from('calendar_links').update(values).eq('id', link.id);
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    const { data } = await api
      .from('calendar_links')
      .insert({ calendar_id: calendar.id, name: newName.trim() })
      .select()
      .single();
    setCreating(false);
    setNewName('');
    await load();
    if (data) setOpenId((data as CalendarLink).id);
  };

  const renew = async () => {
    if (!toRenew) return;
    const link = toRenew;
    setToRenew(null);
    await patch(link, { token: crypto.randomUUID(), last_fetched_at: null });
  };

  const remove = async () => {
    if (!toDelete) return;
    const link = toDelete;
    setToDelete(null);
    await api.from('calendar_links').delete().eq('id', link.id);
    await load();
  };

  return (
    <>
      <Modal open title={`${t('subscribeCalendar')}: ${calendar.name}`} onClose={onClose} size="lg">
        <p className="text-sm text-text-secondary">{t('subscribeCalendarHint')}</p>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="spinner" role="status" aria-label={t('loading')} />
          </div>
        ) : links.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-text-secondary">
            {t('noCalendarLinks')}
          </p>
        ) : (
          <ul className="space-y-2">
            {links.map((link) => (
              <LinkItem
                key={link.id}
                link={link}
                open={openId === link.id}
                onToggle={() => setOpenId((id) => (id === link.id ? null : link.id))}
                onPatch={(values) => patch(link, values)}
                onRenew={() => setToRenew(link)}
                onDelete={() => setToDelete(link)}
              />
            ))}
          </ul>
        )}

        <form onSubmit={create} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Input
              label={t('newCalendarLink')}
              placeholder={t('calendarLinkNamePlaceholder')}
              maxLength={80}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary" disabled={creating || !newName.trim()}>
            <Plus size={15} />
            {t('createLink')}
          </Button>
        </form>

        <p className="text-xs text-text-tertiary">{t('subscribeRefreshHint')}</p>
      </Modal>

      <ConfirmDialog
        open={!!toRenew}
        title={t('renewLink')}
        message={t('renewCalendarLinkConfirm')}
        confirmLabel={t('renewLink')}
        destructive
        onConfirm={renew}
        onCancel={() => setToRenew(null)}
      />
      <ConfirmDialog
        open={!!toDelete}
        title={t('deleteCalendarLink')}
        message={t('deleteCalendarLinkConfirm').replace('{name}', toDelete?.name ?? '')}
        confirmLabel={t('delete')}
        destructive
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </>
  );
};

const CopyField = ({ value, label, multiline = false }: { value: string; label: string; multiline?: boolean }) => {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [value]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const field =
    'min-w-0 flex-1 rounded-md border border-border bg-surface-subtle px-3 py-2 font-mono text-xs text-text-secondary focus:border-black focus:outline-none';
  return (
    <div className={cn('flex gap-2', multiline && 'items-start')}>
      {multiline ? (
        <textarea
          readOnly
          rows={3}
          value={value}
          aria-label={label}
          onFocus={(e) => e.target.select()}
          className={cn(field, 'resize-none')}
        />
      ) : (
        <input readOnly value={value} aria-label={label} onFocus={(e) => e.target.select()} className={field} />
      )}
      <Button variant="secondary" onClick={copy} className="flex-shrink-0">
        {copied ? <Check size={15} /> : <Copy size={15} />}
        {copied ? t('copied') : t('copy')}
      </Button>
    </div>
  );
};

const LinkItem = ({
  link,
  open,
  onToggle,
  onPatch,
  onRenew,
  onDelete,
}: {
  link: CalendarLink;
  open: boolean;
  onToggle: () => void;
  onPatch: (values: Partial<CalendarLink>) => void;
  onRenew: () => void;
  onDelete: () => void;
}) => {
  const { t, lang } = useI18n();
  const [name, setName] = useState(link.name);
  useEffect(() => setName(link.name), [link.name]);
  const urls = feedUrls(link.token);
  const fetched = link.last_fetched_at
    ? t('lastFetched').replace(
        '{when}',
        new Date(link.last_fetched_at).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
      )
    : t('neverFetched');

  const saveName = () => {
    const next = name.trim();
    if (next && next !== link.name) onPatch({ name: next });
    else setName(link.name);
  };

  const appButton =
    'inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-surface-muted';

  return (
    <li className="rounded-md border border-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{link.name}</span>
            {!link.show_details && (
              <span className="flex-shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-text-tertiary">
                {t('withoutDetails')}
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs text-text-tertiary">{fetched}</span>
        </span>
        <ChevronDown
          size={16}
          className={cn('flex-shrink-0 text-text-tertiary transition-transform duration-150', !open && '-rotate-90')}
        />
      </button>

      {open && (
        <div className="space-y-4 border-t border-border px-3 py-3">
          <Input
            label={t('name')}
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />

          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 flex-shrink-0 accent-black"
              checked={link.show_details}
              onChange={(e) => onPatch({ show_details: e.target.checked })}
            />
            <span>
              <span className="block text-sm font-medium">{t('showLinkDetails')}</span>
              <span className="block text-xs text-text-secondary">{t('showLinkDetailsHint')}</span>
            </span>
          </label>

          <div className="space-y-2">
            <p className="text-sm font-medium">{t('subscribeLink')}</p>
            <CopyField value={urls.https} label={t('subscribeLink')} />
            <div className="grid gap-2 sm:grid-cols-2">
              <a href={urls.google} target="_blank" rel="noopener noreferrer" className={appButton}>
                <ExternalLink size={15} />
                {t('openInGoogleCalendar')}
              </a>
              <a href={urls.webcal} className={appButton}>
                <ExternalLink size={15} />
                {t('openInAppleCalendar')}
              </a>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{t('calendarWebView')}</p>
              <a
                href={urls.web}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text"
              >
                <Globe size={14} />
                {t('openWebView')}
              </a>
            </div>
            <CopyField value={urls.web} label={t('calendarWebView')} />
            <p className="flex items-center gap-1.5 pt-1 text-sm font-medium">
              <Code size={14} />
              {t('embedCode')}
            </p>
            <CopyField value={urls.embed} label={t('embedCode')} multiline />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <p className="text-xs text-text-secondary">{t('renewCalendarLinkHint')}</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onRenew}>
                <RefreshCw size={15} />
                {t('renewLink')}
              </Button>
              <Button variant="secondary" onClick={onDelete}>
                <Trash2 size={15} />
                {t('delete')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
};
