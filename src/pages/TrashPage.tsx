import { useCallback, useEffect, useState } from 'react';
import {
  Bookmark,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  Layers,
  ListChecks,
  Music,
  Music2,
  RotateCcw,
  Tags,
  Trash2,
  UserPlus,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageSpinner } from '@/components/Spinner';
import { Toast, useToast } from '@/components/Toast';
import { api, type ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { localeOf } from '@shared/languages';
import { track } from '@/lib/analytics';
import { useProjectContext } from '@/layouts/projectContext';

interface TrashEntry {
  id: string;
  kind: string;
  label: string;
  project_id: string | null;
  project_name: string | null;
  contents: Record<string, number>;
  deleted_by_name: string | null;
  deleted_at: string;
  expires_at: string;
}

const KIND: Record<string, { icon: LucideIcon; label: TranslationKey }> = {
  projects: { icon: Layers, label: 'trashKind_projects' },
  events: { icon: CalendarDays, label: 'trashKind_events' },
  members: { icon: UserRound, label: 'trashKind_members' },
  project_groups: { icon: Tags, label: 'trashKind_project_groups' },
  forms: { icon: ListChecks, label: 'trashKind_forms' },
  concerts: { icon: Music2, label: 'trashKind_concerts' },
  registration_pages: { icon: ClipboardList, label: 'trashKind_registration_pages' },
  registrations: { icon: UserPlus, label: 'trashKind_registrations' },
  absence_labels: { icon: Bookmark, label: 'trashKind_absence_labels' },
  pieces: { icon: Music, label: 'trashKind_pieces' },
  calendars: { icon: CalendarRange, label: 'trashKind_calendars' },
};

// What went with an entry, in a few words ("Anwesenheiten: 120 · Dateien: 3").
const CONTENTS: Array<[string, TranslationKey]> = [
  ['members', 'trashContent_members'],
  ['events', 'trashContent_events'],
  ['attendance', 'trashContent_attendance'],
  ['form_responses', 'trashContent_form_responses'],
  ['registrations', 'trashContent_registrations'],
  ['project_pieces', 'trashContent_project_pieces'],
  ['piece_files', 'trashContent_piece_files'],
  ['concert_recordings', 'trashContent_concert_recordings'],
  ['calendar_events', 'trashContent_calendar_events'],
];

const DAY = 24 * 60 * 60 * 1000;

const ERRORS: Record<string, TranslationKey> = {
  trash_conflict: 'trashConflict',
  trash_parent_missing: 'trashParentMissing',
};

// The Papierkorb (server/trash.ts): deleted projects, Proben, members,
// pieces, surveys, ... with everything that went with them, for 30 days.
// With a project: that project's entries (in its sidebar); without: all the
// account may restore.
const TrashList = ({ projectId }: { projectId: string | null }) => {
  const { t, lang } = useI18n();
  const [entries, setEntries] = useState<TrashEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [purging, setPurging] = useState<TrashEntry | 'all' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const locale = localeOf(lang);

  const load = useCallback(async () => {
    const { data, error: loadError } = await api.rpc('trash_list', projectId ? { p_project_id: projectId } : {});
    if (loadError) setError(loadError.message);
    setEntries((data as TrashEntry[] | null) ?? []);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const messageFor = (err: ApiError) => (err.code && ERRORS[err.code] ? t(ERRORS[err.code]) : err.message);

  const restore = async (entry: TrashEntry) => {
    setBusy(entry.id);
    setError(null);
    const { error: restoreError } = await api.rpc('trash_restore', { p_id: entry.id });
    setBusy(null);
    if (restoreError) return setError(messageFor(restoreError));
    track('trash-restore', { kind: entry.kind });
    toast.show(t('trashRestored').replace('{name}', entry.label));
    await load();
  };

  const purge = async () => {
    const target = purging;
    setPurging(null);
    if (!target) return;
    const { error: purgeError } =
      target === 'all'
        ? await api.rpc('trash_empty', projectId ? { p_project_id: projectId } : {})
        : await api.rpc('trash_purge', { p_id: target.id });
    if (purgeError) setError(purgeError.message);
    await load();
  };

  if (!entries) return <PageSpinner />;

  const dateLabel = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(iso));
  const daysLeft = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / DAY));
  const contentsOf = (entry: TrashEntry) =>
    CONTENTS.filter(([table]) => (entry.contents[table] ?? 0) > 0)
      .map(([table, key]) => t(key).replace('{n}', String(entry.contents[table])))
      .join(' · ');

  return (
    <>
      <PageHeader
        title={t('trash')}
        inlineActions
        actions={
          entries.length > 0 ? (
            <Button variant="secondary" onClick={() => setPurging('all')} aria-label={t('trashEmptyAll')}>
              <Trash2 size={15} />
              <span className="max-sm:hidden">{t('trashEmptyAll')}</span>
            </Button>
          ) : null
        }
      />
      {error && <p className="mb-4 text-sm text-danger-strong">{error}</p>}

      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-muted text-text-tertiary">
            <Trash2 size={20} />
          </span>
          <p className="font-semibold">{t('trashBinEmpty')}</p>
          <p className="text-sm text-text-secondary">{t('trashEmptyHint')}</p>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-text-secondary">{t('trashBinHint')}</p>
          <ul className="overflow-hidden rounded-2xl border border-border bg-surface">
            {entries.map((entry) => {
              const kind = KIND[entry.kind] ?? { icon: Trash2, label: 'trash' as TranslationKey };
              const Icon = kind.icon;
              const contents = contentsOf(entry);
              const deleted = (entry.deleted_by_name ? t('trashDeletedBy') : t('trashDeletedAt'))
                .replace('{date}', dateLabel(entry.deleted_at))
                .replace('{name}', entry.deleted_by_name ?? '');
              const meta = [
                !projectId && entry.kind !== 'projects' ? entry.project_name : null,
                contents || null,
                deleted,
                t('trashDaysLeft').replace('{n}', String(daysLeft(entry.expires_at))),
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <li
                  key={entry.id}
                  className="group/trash flex flex-col gap-3 border-b border-border px-4 py-3 last:border-b-0 sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-surface-muted text-text-secondary">
                      <Icon size={17} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium" title={entry.label}>
                          {entry.label}
                        </span>
                        <span className="flex-shrink-0 rounded bg-surface-muted px-1.5 py-px text-[10px] font-semibold text-text-secondary">
                          {t(kind.label)}
                        </span>
                      </p>
                      <p className="line-clamp-2 text-xs text-text-tertiary sm:line-clamp-1" title={meta}>
                        {meta}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1 pl-12 sm:pl-0">
                    <Button
                      variant="secondary"
                      onClick={() => void restore(entry)}
                      disabled={busy === entry.id}
                      className="h-9"
                    >
                      <RotateCcw size={15} />
                      {t('trashRestore')}
                    </Button>
                    <button
                      type="button"
                      onClick={() => setPurging(entry)}
                      title={t('deletePermanently')}
                      aria-label={t('deletePermanently')}
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-lg text-text-tertiary transition-opacity duration-150 hover:bg-danger-soft hover:text-danger-strong',
                        'focus:opacity-100 lg:opacity-0 lg:group-hover/trash:opacity-100',
                      )}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <ConfirmDialog
        open={purging !== null}
        title={purging === 'all' ? t('trashEmptyAll') : t('deletePermanently')}
        message={
          purging === 'all'
            ? t('trashEmptyAllConfirm').replace('{n}', String(entries.length))
            : t('trashPurgeConfirm').replace('{name}', purging?.label ?? '')
        }
        confirmLabel={t('deletePermanently')}
        destructive
        onConfirm={() => void purge()}
        onCancel={() => setPurging(null)}
      />
      <Toast toast={toast.toast} onClose={toast.hide} />
    </>
  );
};

// Everything the account may restore (projects, pieces, calendars and the
// projects' entries).
export const TrashPage = () => <TrashList projectId={null} />;

// One project's entries, in its sidebar.
export const ProjectTrashPage = () => {
  const { project } = useProjectContext();
  return <TrashList projectId={project.id} />;
};
