import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import {
  ChevronDown,
  Cpu,
  Database,
  FileText,
  Globe,
  KeyRound,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  TriangleAlert,
  Webhook,
  X,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { HeaderAction } from '@/components/HeaderAction';
import { TableFilterMenu, type FilterMenuFilter } from '@/components/TableFilterMenu';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { PageSpinner, Spinner } from '@/components/Spinner';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { Language } from '@/lib/config';
import {
  CATEGORY_LABEL,
  actionLabel,
  changeTitle,
  columnLabel,
  deviceLabel,
  entrySubject,
  formatValue,
  opLabel,
  tableLabel,
  type AuditActor,
  type AuditCategory,
  type AuditChange,
  type AuditEntry,
} from '@/lib/audit';

const CATEGORY_ICON: Record<AuditCategory, LucideIcon> = {
  auth: KeyRound,
  data: Database,
  public: Globe,
  files: FileText,
  admin: ShieldCheck,
  webhook: Webhook,
  system: Cpu,
};

const OP_STYLE = {
  insert: 'bg-success-soft text-success-strong',
  update: 'bg-info-soft text-text',
  delete: 'bg-danger-soft text-danger-strong',
} as const;

// Labels of the facts a few actions note besides their changes.
const DETAIL_LABEL: Record<string, { de: string; en: string }> = {
  method: { de: 'Methode', en: 'Method' },
  email: { de: 'E-Mail', en: 'Email' },
  file: { de: 'Datei', en: 'File' },
  files: { de: 'Dateien', en: 'Files' },
  size: { de: 'Größe', en: 'Size' },
  scope: { de: 'Umfang', en: 'Scope' },
  to: { de: 'Empfänger', en: 'Recipient' },
  host: { de: 'Server', en: 'Server' },
  kind: { de: 'Art', en: 'Kind' },
  denied_rows: { de: 'Zeilen ohne Berechtigung', en: 'Rows without permission' },
  email_change_requested: { de: 'Neue E-Mail angefragt', en: 'New email requested' },
};

const formatDetail = (key: string, value: unknown, lang: Language) => {
  if (key === 'size' && typeof value === 'number') {
    return value > 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} kB`;
  }
  if (Array.isArray(value)) return value.map((v) => String(v).split('/').pop()).join(', ');
  return formatValue(value, lang);
};

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

interface Filters {
  category: string;
  status: string;
  range: string;
  // An account id, or @anonymous / @system / @webhook.
  actor: string;
}

const NO_FILTERS: Filters = { category: '', status: '', range: '', actor: '' };

// Admin → Audit-Log: every action of every person, newest first. The server
// filters and pages (server/audit.ts); the page only renders.
export const AdminAuditPage = () => {
  const { t, lang } = useI18n();
  const { isAdmin } = useAuth();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [actors, setActors] = useState<AuditActor[]>([]);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Only the newest request may fill the list.
  const requestRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(
    async (before: number | null) => {
      const request = ++requestRef.current;
      setLoading(true);
      setError(null);
      const { data, error } = await api.functions.invoke('admin-audit-log', {
        body: { ...filters, q: debouncedQuery, before },
      });
      if (request !== requestRef.current) return;
      setLoading(false);
      if (error || !data) {
        setError(error?.message ?? t('auditLoadFailed'));
        if (!before) setEntries([]);
        return;
      }
      const page = data as { entries: AuditEntry[]; next: number | null; actors?: AuditActor[] };
      setEntries((current) => (before && current ? [...current, ...page.entries] : page.entries));
      setNext(page.next);
      if (page.actors) setActors(page.actors);
    },
    [filters, debouncedQuery, t],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const setFilter = (key: keyof Filters) => (value: string) => setFilters((f) => ({ ...f, [key]: value }));

  const menuFilters: FilterMenuFilter[] = [
    {
      id: 'category',
      label: t('auditCategory'),
      options: (Object.keys(CATEGORY_LABEL) as AuditCategory[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c][lang] })),
      value: filters.category,
      onChange: setFilter('category'),
    },
    {
      // People are picked by clicking their name in an entry; these are the
      // actors without an account.
      id: 'actor',
      label: t('auditActorKind'),
      options: [
        { value: '@anonymous', label: t('auditAnonymous') },
        { value: '@webhook', label: t('auditWebhook') },
        { value: '@system', label: t('auditSystem') },
      ],
      value: filters.actor.startsWith('@') ? filters.actor : '',
      onChange: setFilter('actor'),
    },
    {
      id: 'status',
      label: t('status'),
      options: [{ value: 'failed', label: t('auditFailed') }],
      value: filters.status,
      onChange: setFilter('status'),
    },
    {
      id: 'range',
      label: t('timeframe'),
      options: [
        { value: '24h', label: t('audit24h') },
        { value: '7d', label: t('audit7d') },
        { value: '30d', label: t('audit30d') },
        { value: '90d', label: t('audit90d') },
      ],
      value: filters.range,
      onChange: setFilter('range'),
    },
  ];

  // Entries grouped by local day, newest first.
  const days = useMemo(() => {
    const groups: { key: string; date: Date; entries: AuditEntry[] }[] = [];
    for (const entry of entries ?? []) {
      const date = new Date(entry.at);
      const key = dayKey(date);
      const last = groups[groups.length - 1];
      if (last?.key === key) last.entries.push(entry);
      else groups.push({ key, date, entries: [entry] });
    }
    return groups;
  }, [entries]);

  const dayTitle = (date: Date) => {
    const now = new Date();
    if (dayKey(date) === dayKey(now)) return t('auditToday');
    if (dayKey(date) === dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) {
      return t('auditYesterday');
    }
    return date.toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-US', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  const toggle = (id: string) =>
    setExpanded((current) => {
      const nextSet = new Set(current);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return nextSet;
    });

  const replaceChanges = (id: string, changes: AuditChange[]) =>
    setEntries((current) => current?.map((e) => (e.id === id ? { ...e, changes } : e)) ?? current);

  if (!isAdmin) return <Navigate to="/" replace />;
  if (entries === null) return <PageSpinner />;

  const person = filters.actor && !filters.actor.startsWith('@') ? actors.find((a) => a.id === filters.actor) : null;
  const personName = person?.name ?? person?.email ?? t('auditDeletedAccount');

  return (
    <div>
      <PageHeader
        title={t('auditLog')}
        subtitle={t('auditLogHint')}
        inlineActions
        actions={
          <>
            <TableFilterMenu
              query={query}
              onQueryChange={setQuery}
              filters={menuFilters}
              placeholder={t('auditSearchPlaceholder')}
              onReset={() => setFilters(NO_FILTERS)}
              canReset={filters.actor !== ''}
            />
            <HeaderAction icon={RefreshCw} label={t('auditRefresh')} variant="secondary" onClick={() => void load(null)} />
          </>
        }
      />

      {filters.actor && !filters.actor.startsWith('@') && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-md border border-border bg-surface py-1 pl-1.5 pr-1 text-sm">
            <Avatar name={personName} size={20} />
            <span className="font-medium">{personName}</span>
            <button
              type="button"
              aria-label={t('clearFilters')}
              onClick={() => setFilter('actor')('')}
              className="rounded p-0.5 text-text-tertiary hover:text-text"
            >
              <X size={14} />
            </button>
          </span>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-danger">{error}</p>}

      {entries.length === 0 && !loading ? (
        <EmptyState icon={ScrollText} message={t('auditEmpty')} />
      ) : (
        <div className="space-y-6">
          {days.map((day) => (
            <section key={day.key}>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">
                {dayTitle(day.date)}
              </h2>
              <ol className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
                {day.entries.map((entry) => (
                  <AuditRow
                    key={entry.id}
                    entry={entry}
                    open={expanded.has(entry.id)}
                    onToggle={() => toggle(entry.id)}
                    onPerson={setFilter('actor')}
                    onAllChanges={(changes) => replaceChanges(entry.id, changes)}
                  />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      <div className="mt-6 flex justify-center">
        {loading ? (
          <Spinner />
        ) : (
          next !== null && (
            <Button variant="secondary" onClick={() => void load(next)}>
              {t('auditLoadMore')}
            </Button>
          )
        )}
      </div>
    </div>
  );
};

const ActorAvatar = ({ entry }: { entry: AuditEntry }) => {
  const { kind, name, email } = entry.actor;
  if (kind === 'user') return <Avatar name={name ?? email ?? '?'} size={28} />;
  const Icon = kind === 'webhook' ? Webhook : kind === 'system' ? Cpu : Globe;
  return (
    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-border bg-surface-hover text-text-secondary">
      <Icon size={14} />
    </div>
  );
};

const AuditRow = ({
  entry,
  open,
  onToggle,
  onPerson,
  onAllChanges,
}: {
  entry: AuditEntry;
  open: boolean;
  onToggle: () => void;
  onPerson: (id: string) => void;
  onAllChanges: (changes: AuditChange[]) => void;
}) => {
  const { t, lang } = useI18n();
  const failed = entry.status === 'failed';
  const subject = entrySubject(entry);
  const CategoryIcon = CATEGORY_ICON[entry.category] ?? Database;
  const actorName =
    entry.actor.kind === 'user'
      ? (entry.actor.name ?? entry.actor.email ?? t('auditDeletedAccount'))
      : entry.actor.kind === 'webhook'
        ? t('auditWebhook')
        : entry.actor.kind === 'system'
          ? (entry.actor.name ?? t('auditSystem'))
          : t('auditAnonymous');

  // A single changed row: its fields are previewed right in the list.
  const single = entry.change_count === 1 && entry.changes[0]?.op === 'update' ? entry.changes[0] : null;
  const preview = single ? Object.entries(single.data ?? {}).slice(0, 2) : [];

  return (
    <li className={cn(failed && 'bg-danger-soft/40')}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-surface-hover sm:px-4"
      >
        <span className="w-14 flex-shrink-0 whitespace-nowrap pt-1 text-xs tabular-nums text-text-tertiary">
          {new Date(entry.at).toLocaleTimeString(lang === 'de' ? 'de-DE' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
        </span>
        <ActorAvatar entry={entry} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-6">
            <span className="font-medium">{actorName}</span>{' '}
            <span className={failed ? 'text-danger' : 'text-text-secondary'}>{actionLabel(entry, lang)}</span>
            {subject && <span className="font-medium"> · {subject}</span>}
          </span>
          {preview.length > 0 && (
            <span className="block truncate text-xs text-text-secondary">
              {preview.map(([column, value], i) => {
                const [before, after] = value as [unknown, unknown];
                return (
                  <span key={column}>
                    {i > 0 && ' · '}
                    {columnLabel(column, lang)}: {formatValue(before, lang)} → {formatValue(after, lang)}
                  </span>
                );
              })}
            </span>
          )}
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-tertiary">
            <span className="inline-flex items-center gap-1">
              <CategoryIcon size={12} />
              {CATEGORY_LABEL[entry.category]?.[lang] ?? entry.category}
            </span>
            {entry.change_count > 0 && (
              <span>
                {entry.change_count === 1
                  ? t('auditOneChange')
                  : t('auditChanges').replace('{n}', entry.change_count.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US'))}
              </span>
            )}
            {failed && (
              <span className="inline-flex items-center gap-1 font-medium text-danger">
                <TriangleAlert size={12} />
                {t('auditFailed')}
              </span>
            )}
          </span>
        </span>
        <ChevronDown
          size={16}
          className={cn('mt-1 flex-shrink-0 text-text-tertiary transition-transform duration-150', open && 'rotate-180')}
        />
      </button>

      {open && <AuditDetails entry={entry} actorName={actorName} onPerson={onPerson} onAllChanges={onAllChanges} />}
    </li>
  );
};

const AuditDetails = ({
  entry,
  actorName,
  onPerson,
  onAllChanges,
}: {
  entry: AuditEntry;
  actorName: string;
  onPerson: (id: string) => void;
  onAllChanges: (changes: AuditChange[]) => void;
}) => {
  const { t, lang } = useI18n();
  const [loadingAll, setLoadingAll] = useState(false);
  const actorId = entry.actor.id;

  const facts: [string, ReactNode][] = [
    [
      t('auditTime'),
      new Date(entry.at).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { dateStyle: 'full', timeStyle: 'medium' }),
    ],
    [
      t('auditPerson'),
      actorId ? (
        <button
          type="button"
          onClick={() => onPerson(actorId)}
          className="text-left underline decoration-border-strong underline-offset-2 hover:decoration-text"
          title={t('auditFilterPerson')}
        >
          {actorName}
          {entry.actor.email && entry.actor.email !== actorName && (
            <span className="text-text-secondary"> ({entry.actor.email})</span>
          )}
        </button>
      ) : (
        actorName
      ),
    ],
  ];
  if (entry.ip) facts.push([t('auditIp'), <span className="font-mono text-xs">{entry.ip}</span>]);
  const device = deviceLabel(entry.user_agent, lang);
  if (device) facts.push([t('auditDevice'), <span title={entry.user_agent ?? undefined}>{device}</span>]);
  for (const [key, value] of Object.entries(entry.details ?? {})) {
    facts.push([DETAIL_LABEL[key]?.[lang] ?? key, formatDetail(key, value, lang)]);
  }
  if (entry.path) {
    facts.push([
      t('auditRequest'),
      <span className="break-all font-mono text-xs text-text-secondary">
        {entry.method} {entry.path}
        {entry.target ? ` · ${entry.target}` : ''}
      </span>,
    ]);
  }

  const loadAll = async () => {
    setLoadingAll(true);
    const { data } = await api.functions.invoke('admin-audit-entry', { body: { id: entry.id } });
    setLoadingAll(false);
    if (data) onAllChanges((data as { changes: AuditChange[] }).changes);
  };

  return (
    <div className="space-y-4 border-t border-border bg-surface-subtle px-3 py-4 sm:px-4 sm:pl-[6.5rem]">
      {entry.status === 'failed' && (
        <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger-strong">
          <TriangleAlert size={16} className="mt-0.5 flex-shrink-0" />
          <span>{entry.error ?? t('auditFailed')}</span>
        </div>
      )}

      <dl className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        {facts.map(([label, value], i) => (
          <div key={i} className="contents">
            <dt className="text-text-tertiary">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>

      {entry.changes.length > 0 && (
        <div className="space-y-2">
          {entry.change_summary.length > 1 && (
            <p className="text-xs text-text-tertiary">
              {entry.change_summary
                .map((s) => `${s.count} × ${tableLabel(s.table, lang)} ${opLabel(s.op, lang)}`)
                .join(' · ')}
            </p>
          )}
          {entry.changes.map((change) => (
            <ChangeCard key={change.id} change={change} />
          ))}
          {entry.change_count > entry.changes.length && (
            <Button variant="secondary" onClick={() => void loadAll()} disabled={loadingAll}>
              {t('auditShowAllChanges').replace('{n}', String(entry.change_count))}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

// Fields shown before "show more" on a created or deleted row.
const FIELDS_SHOWN = 8;

const ChangeCard = ({ change }: { change: AuditChange }) => {
  const { t, lang } = useI18n();
  const [all, setAll] = useState(false);
  const title = changeTitle(change);
  const refs = Object.entries(change.refs ?? {}).filter(([, r]) => r.label && r.label !== title);
  // References show as chips by name; their raw ids add nothing.
  const fields = Object.entries(change.data ?? {}).filter(([column]) => !(change.refs && column in change.refs));
  const shown = all ? fields : fields.slice(0, FIELDS_SHOWN);

  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', OP_STYLE[change.op])}>
          {opLabel(change.op, lang)}
        </span>
        <span className="text-text-secondary">{tableLabel(change.table, lang)}</span>
        {title && <span className="font-medium">{title}</span>}
      </div>
      {refs.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {refs.map(([column, ref]) => (
            <span key={column} className="rounded border border-border px-1.5 py-0.5 text-xs text-text-secondary">
              {columnLabel(column, lang)}: <span className="text-text">{ref.label}</span>
            </span>
          ))}
        </div>
      )}
      {shown.length > 0 && (
        <dl className="mt-2 grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          {shown.map(([column, value]) => {
            const [before, after] = change.op === 'update' ? (value as [unknown, unknown]) : [null, value];
            return (
              <div key={column} className="contents">
                <dt className="truncate text-text-tertiary" title={column}>
                  {columnLabel(column, lang)}
                </dt>
                <dd className="min-w-0 break-words">
                  {change.op === 'update' ? (
                    <>
                      <span className="text-text-tertiary line-through">{formatValue(before, lang)}</span>
                      <span className="px-1.5 text-text-tertiary">→</span>
                      <span className="font-medium">{formatValue(after, lang)}</span>
                    </>
                  ) : (
                    formatValue(after, lang)
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {fields.length > FIELDS_SHOWN && (
        <button
          type="button"
          onClick={() => setAll((a) => !a)}
          className="mt-1.5 text-xs font-medium text-text-tertiary hover:text-text"
        >
          {all ? t('auditFewerFields') : t('auditMoreFields').replace('{n}', String(fields.length - FIELDS_SHOWN))}
        </button>
      )}
    </div>
  );
};
