import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Download,
  EyeOff,
  FileArchive,
  ListTree,
  Paperclip,
  Search,
  Table2,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable, type Column } from '@/components/DataTable';
import { PageSpinner } from '@/components/Spinner';
import { SummaryItem } from '@/components/FormSummary';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { localeOf } from '@shared/languages';
import { downloadBlob, filenamePart, toCsv } from '@/lib/absenceExports';
import { formatBytes } from '@/lib/concerts';
import { formDate, type FormDetail, type FormResponse, type FormResults, type FormSummaryItem } from '@/lib/forms';
import { DISPLAY_TYPES, answerText, instantRunoff, type ItemType, type SnapshotItem } from '@shared/forms';

type View = 'summary' | 'single' | 'table';

interface Column_ {
  id: string;
  type: ItemType;
  title: string;
  // Labels across versions (option ids are kept when a form changes).
  options?: Record<string, string>;
  rows?: Record<string, string>;
  columns?: Record<string, string>;
  scale_min?: number;
  scale_max?: number;
}

const CHOICE: ItemType[] = ['single', 'multi', 'dropdown', 'ranking', 'yesno', 'scale', 'stars', 'grid'];
const FREE_TEXT: ItemType[] = ['short', 'long'];

// The responses of a survey for its managers: a summary, one response at a
// time and a table — all following the same search and filter, as do the
// exports. Names appear only where the form is named.
export const SurveyResults = ({ detail, onChanged }: { detail: FormDetail; onChanged: () => Promise<void> }) => {
  const { t, lang } = useI18n();
  const locale = localeOf(lang);
  const [results, setResults] = useState<FormResults | null>(null);
  const [view, setView] = useState<View>('summary');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<{ item: string; value: string } | null>(null);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<string[] | 'all' | null>(null);

  const load = useCallback(async () => {
    const { data } = await api.rpc('form_results', { p_form_id: detail.form.id });
    setResults(data as FormResults);
  }, [detail.form.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const words = useMemo(
    () => ({ yes: t('yes'), no: t('no'), files: (n: number) => t('formFilesCount').replace('{n}', String(n)) }),
    [t],
  );

  // The questions as columns: the current version's order, then any only
  // older versions had.
  const columns = useMemo<Column_[]>(() => {
    if (!results) return [];
    const latest = results.versions[results.versions.length - 1]?.structure.items ?? detail.draft.items;
    const out = new Map<string, Column_>();
    for (const item of latest) {
      if (DISPLAY_TYPES.includes(item.type)) continue;
      const map = (list?: { id: string; label: string }[]) => (list ? Object.fromEntries(list.map((o) => [o.id, o.label])) : undefined);
      out.set(item.id, {
        id: item.id,
        type: item.type,
        title: item.title,
        options: map(item.options),
        rows: map(item.rows),
        columns: map(item.columns),
        scale_min: item.scale_min,
        scale_max: item.scale_max,
      });
    }
    for (const r of results.responses) {
      for (const [id, snap] of Object.entries(r.snapshot)) {
        const col = out.get(id);
        if (!col) out.set(id, { id, type: snap.type, title: snap.title, options: snap.options, rows: snap.rows, columns: snap.columns });
        else {
          // Labels of options that only older versions had.
          col.options = { ...snap.options, ...col.options };
          col.rows = snap.rows ? { ...snap.rows, ...col.rows } : col.rows;
          col.columns = snap.columns ? { ...snap.columns, ...col.columns } : col.columns;
        }
      }
    }
    return [...out.values()];
  }, [results, detail.draft.items]);

  const text = useCallback(
    (r: FormResponse, col: Column_) => {
      const snap: SnapshotItem = r.snapshot[col.id] ?? col;
      return answerText(snap, r.answers[col.id], words);
    },
    [words],
  );

  const shown = useMemo(() => {
    if (!results) return [];
    const q = query.trim().toLowerCase();
    return results.responses.filter((r) => {
      if (filter) {
        const v = r.answers[filter.item];
        const hit = Array.isArray(v) ? v.includes(filter.value) : String(v) === filter.value;
        if (!hit) return false;
      }
      if (!q) return true;
      const hay = [r.respondent?.name, r.respondent?.email, ...columns.map((c) => text(r, c))].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [results, filter, query, columns, text]);

  useEffect(() => setIndex(0), [filter, query]);

  if (!results) return <PageSpinner />;
  const named = results.identity === 'named';
  const filesOf = (r: FormResponse, itemId?: string) =>
    results.files.filter((f) => f.response_id === r.id && (!itemId || f.item_id === itemId));
  const anyFiles = shown.some((r) => filesOf(r).length > 0);

  const exportCsv = () => {
    const header = [...(named ? [t('name'), t('email'), t('surveySubmittedAt')] : []), ...columns.map((c) => c.title)];
    const rows = shown.map((r) => [
      ...(named ? [r.respondent?.name ?? '', r.respondent?.email ?? '', r.submitted_at ? formDate(r.submitted_at, lang) : ''] : []),
      ...columns.map((c) => text(r, c)),
    ]);
    downloadBlob(new Blob([toCsv([header, ...rows])], { type: 'text/csv;charset=utf-8' }), `${filenamePart(results.title)}.csv`);
  };

  const zip = () => {
    const ids = shown.filter((r) => filesOf(r).length > 0).map((r) => r.id);
    window.location.href = `/api/forms/zip/${detail.form.id}?responses=${ids.join(',')}`;
  };

  const remove = async () => {
    if (!deleting) return;
    await api.rpc('form_delete_responses', deleting === 'all' ? { p_form_id: detail.form.id, p_all: true } : { p_form_id: detail.form.id, p_ids: deleting });
    setDeleting(null);
    setSelected([]);
    await load();
    await onChanged();
  };

  const review = async (r: FormResponse, itemId: string) => {
    const on = !r.reviewed.includes(itemId);
    setResults((res) =>
      res
        ? {
            ...res,
            responses: res.responses.map((x) =>
              x.id === r.id ? { ...x, reviewed: on ? [...x.reviewed, itemId] : x.reviewed.filter((i) => i !== itemId) } : x,
            ),
          }
        : res,
    );
    await api.rpc('form_review', { p_response_id: r.id, p_item_id: itemId, p_reviewed: on });
  };

  const filterable = columns.filter((c) => ['single', 'multi', 'dropdown', 'yesno'].includes(c.type));
  const current = shown[Math.min(index, shown.length - 1)];

  return (
    <div className="space-y-4">
      <Participation results={results} />

      {results.responses.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border-strong px-4 py-10 text-center text-sm text-text-secondary">
          {t('surveyNoResponses')}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="flex rounded-lg bg-surface-muted p-0.5">
              {(
                [
                  ['summary', BarChart3, 'surveyViewSummary'],
                  ['single', ListTree, 'surveyViewSingle'],
                  ['table', Table2, 'surveyViewTable'],
                ] as const
              ).map(([id, Icon, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={view === id}
                  onClick={() => setView(id)}
                  className={cn(
                    'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm max-md:h-11',
                    view === id ? 'bg-surface font-medium shadow-sm' : 'text-text-secondary',
                  )}
                >
                  <Icon size={14} />
                  {t(label)}
                </button>
              ))}
            </div>
            <div className="relative min-w-0 flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('surveySearchAnswers')}
                aria-label={t('surveySearchAnswers')}
                className="h-10 w-full rounded-md border border-border bg-white pl-9 pr-3 text-sm focus:border-black focus:outline-none max-md:h-11"
              />
            </div>
            {filterable.length > 0 && (
              <select
                value={filter ? `${filter.item}|${filter.value}` : ''}
                aria-label={t('surveyFilter')}
                onChange={(e) => {
                  const [item, value] = e.target.value.split('|');
                  setFilter(item ? { item, value } : null);
                }}
                className="h-10 rounded-md border border-border bg-white px-2 pr-8 text-sm max-md:h-11 lg:max-w-xs"
              >
                <option value="">{t('surveyFilterAll')}</option>
                {filterable.map((c) => (
                  <optgroup key={c.id} label={c.title}>
                    {(c.type === 'yesno' ? { true: t('yes'), false: t('no') } : (c.options ?? {})) &&
                      Object.entries(c.type === 'yesno' ? { true: t('yes'), false: t('no') } : (c.options ?? {})).map(([value, label]) => (
                        <option key={value} value={`${c.id}|${value}`}>
                          {label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-text-secondary">
              {t('surveyShownOf').replace('{n}', String(shown.length)).replace('{total}', String(results.responses.length))}
            </span>
            {(filter || query) && (
              <button
                type="button"
                onClick={() => {
                  setFilter(null);
                  setQuery('');
                }}
                className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-text-secondary hover:bg-surface-muted"
              >
                <X size={13} />
                {t('clearFilters')}
              </button>
            )}
            <span className="flex-1" />
            <Button variant="secondary" className="h-8 px-3" onClick={exportCsv} disabled={shown.length === 0}>
              <Download size={14} />
              CSV
            </Button>
            {anyFiles && (
              <Button variant="secondary" className="h-8 px-3" onClick={zip}>
                <FileArchive size={14} />
                ZIP
              </Button>
            )}
            <Button variant="secondary" className="h-8 px-3" onClick={() => setDeleting('all')}>
              <Trash2 size={14} />
              {t('surveyDeleteAll')}
            </Button>
          </div>

          {view === 'summary' && (
            <div className="grid gap-3 md:grid-cols-2">
              {columns.map((col) => (
                <SummaryBlock
                  key={col.id}
                  col={col}
                  responses={shown}
                  text={text}
                  files={(r) => filesOf(r, col.id)}
                  onReview={review}
                  locale={locale}
                />
              ))}
            </div>
          )}

          {view === 'single' && current && (
            <div className="rounded-2xl border border-border bg-surface">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  aria-label={t('previous')}
                  className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-surface-hover disabled:opacity-30"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="min-w-0 flex-1 text-center text-sm tabular-nums text-text-secondary">
                  {t('surveyResponseOf').replace('{n}', String(index + 1)).replace('{total}', String(shown.length))}
                </span>
                <button
                  type="button"
                  disabled={index >= shown.length - 1}
                  onClick={() => setIndex((i) => Math.min(shown.length - 1, i + 1))}
                  aria-label={t('next')}
                  className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-surface-hover disabled:opacity-30"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="space-y-4 p-4">
                {named && current.respondent ? (
                  <div className="flex items-center gap-3">
                    <Avatar name={current.respondent.name || current.respondent.email || '?'} photoUrl={current.respondent.photo_url} size={36} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{current.respondent.name || t('formGuest')}</p>
                      <p className="truncate text-xs text-text-tertiary">
                        {[current.respondent.email, current.submitted_at ? formDate(current.submitted_at, lang) : null].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="flex items-center gap-1.5 text-sm text-text-secondary">
                    <EyeOff size={14} />
                    {results.identity === 'anonymous' ? t('surveyAnonymousResponse') : t('surveyConfidentialResponse')}
                  </p>
                )}
                <dl className="space-y-3">
                  {columns.map((col) => (
                    <div key={col.id}>
                      <dt className="text-sm text-text-secondary">{col.title}</dt>
                      <dd className="mt-0.5 flex items-start gap-2">
                        <span className="min-w-0 flex-1 whitespace-pre-line break-words">
                          {text(current, col) || <span className="text-text-tertiary">—</span>}
                        </span>
                        {FREE_TEXT.includes(col.type) && text(current, col) && (
                          <ReviewToggle on={current.reviewed.includes(col.id)} onClick={() => void review(current, col.id)} />
                        )}
                      </dd>
                      {filesOf(current, col.id).map((f) => (
                        <FileLink key={f.id} id={f.id} name={f.file_name} size={f.size} locale={locale} />
                      ))}
                    </div>
                  ))}
                </dl>
                <div className="flex justify-end border-t border-border pt-3">
                  <Button variant="secondary" className="h-8 px-3" onClick={() => setDeleting([current.id])}>
                    <Trash2 size={14} />
                    {t('surveyDeleteResponse')}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {view === 'table' && (
            <>
              {selected.length > 0 && (
                <div className="flex items-center gap-2 rounded-xl bg-surface-muted px-3 py-2 text-sm">
                  <span className="flex-1">{t('selectedCount').replace('{n}', String(selected.length))}</span>
                  <Button variant="secondary" className="h-8 px-3" onClick={() => setDeleting(selected)}>
                    <Trash2 size={14} />
                    {t('delete')}
                  </Button>
                </div>
              )}
              <DataTable
                variant="modern"
                rows={shown}
                getRowId={(r) => r.id}
                hideToolbar
                selectedIds={selected}
                onSelectedIdsChange={setSelected}
                onRowClick={(r) => {
                  setIndex(shown.indexOf(r));
                  setView('single');
                }}
                emptyMessage={t('surveyNoResponses')}
                columns={
                  [
                    ...(named
                      ? [
                          {
                            id: 'who',
                            header: t('name'),
                            accessor: (r: FormResponse) => r.respondent?.name ?? '',
                            className: 'w-48',
                          },
                          {
                            id: 'at',
                            header: t('surveySubmittedAt'),
                            accessor: (r: FormResponse) => r.submitted_at ?? '',
                            render: (r: FormResponse) => (r.submitted_at ? formDate(r.submitted_at, lang) : '—'),
                            className: 'w-40',
                          },
                        ]
                      : []),
                    ...columns.map((col) => ({
                      id: col.id,
                      header: col.title,
                      accessor: (r: FormResponse) => text(r, col),
                      render: (r: FormResponse) => (
                        <span className="block truncate" title={text(r, col)}>
                          {text(r, col) || '—'}
                        </span>
                      ),
                      className: 'w-48',
                    })),
                  ] as Column<FormResponse>[]
                }
              />
            </>
          )}
        </>
      )}

      <ConfirmDialog
        open={deleting != null}
        title={t('delete')}
        message={
          deleting === 'all'
            ? t('surveyDeleteAllConfirm').replace('{n}', String(results.responses.length))
            : t('surveyDeleteConfirmN').replace('{n}', String(Array.isArray(deleting) ? deleting.length : 0))
        }
        confirmLabel={t('deletePermanently')}
        destructive
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
};

// Who took part (named, confidential) or how many (anonymous), and who still
// hasn't, for forms meant for the project's participants.
const Participation = ({ results }: { results: FormResults }) => {
  const { t, lang } = useI18n();
  const p = results.participation;
  if ('count' in p) {
    return (
      <p className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-text-secondary">
        <UsersRound size={15} />
        {t('surveyParticipationAnonymous').replace('{n}', String(p.count))}
      </p>
    );
  }
  return (
    <details className="rounded-2xl border border-border bg-surface px-4 py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
        <UsersRound size={15} className="text-text-secondary" />
        <span className="font-medium">{t('surveyParticipation')}</span>
        <span className="text-text-secondary">
          {t('surveyRespondedCount').replace('{n}', String(p.responded.length))}
          {p.pending ? ` · ${t('surveyPendingCount').replace('{n}', String(p.pending.length))}` : ''}
        </span>
      </summary>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('surveyResponded')}</p>
          <ul className="space-y-1 text-sm">
            {p.responded.map((r, i) => (
              <li key={i} className="flex items-center gap-2">
                <CheckCircle2 size={14} className="flex-shrink-0 text-success" />
                <span className="min-w-0 flex-1 truncate">{r.name || r.invite_label || r.email || r.invite_email}</span>
                {r.at.length > 10 && <span className="text-xs text-text-tertiary">{formDate(r.at, lang, false)}</span>}
              </li>
            ))}
          </ul>
        </div>
        {p.pending && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('surveyPending')}</p>
            <ul className="space-y-1 text-sm">
              {p.pending.map((m) => (
                <li key={m.member_id} className="flex items-center gap-2">
                  <Circle size={14} className="flex-shrink-0 text-text-tertiary" />
                  <span className="min-w-0 flex-1 truncate">
                    {m.first_name} {m.last_name}
                  </span>
                  {!m.has_account && <span className="text-xs text-text-tertiary">{t('surveyNoAccount')}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {results.identity === 'confidential' && <p className="mt-3 text-xs text-text-tertiary">{t('surveyConfidentialNote')}</p>}
    </details>
  );
};

// One question in the summary: bars for choices, figures for numbers, the
// answers for free text (each can be marked as checked) and files.
const SummaryBlock = ({
  col,
  responses,
  text,
  files,
  onReview,
  locale,
}: {
  col: Column_;
  responses: FormResponse[];
  text: (r: FormResponse, col: Column_) => string;
  files: (r: FormResponse) => FormResults['files'];
  onReview: (r: FormResponse, itemId: string) => Promise<void>;
  locale: string;
}) => {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const answered = responses.filter((r) => r.answers[col.id] !== undefined && r.answers[col.id] !== null);

  if (CHOICE.includes(col.type)) {
    const counts: Record<string, number> = {};
    for (const r of answered) {
      const v = r.answers[col.id];
      const add = (key: string) => (counts[key] = (counts[key] ?? 0) + 1);
      if (Array.isArray(v)) v.forEach((x) => add(String(x)));
      else if (v && typeof v === 'object') Object.entries(v).forEach(([row, c]) => add(`${row}:${c}`));
      else add(String(v));
    }
    const item: FormSummaryItem = {
      id: col.id,
      type: col.type,
      title: col.title,
      options: col.options ? Object.entries(col.options).map(([id, label]) => ({ id, label })) : undefined,
      rows: col.rows ? Object.entries(col.rows).map(([id, label]) => ({ id, label })) : undefined,
      columns: col.columns ? Object.entries(col.columns).map(([id, label]) => ({ id, label })) : undefined,
      scale_min: col.scale_min,
      scale_max: col.scale_max,
      answered: answered.length,
      counts,
      ...(col.type === 'ranking' && {
        runoff: instantRunoff(
          answered.map((r) => r.answers[col.id]).filter(Array.isArray).map((b) => b.map(String)),
          Object.keys(col.options ?? {}),
        ),
      }),
    };
    return <SummaryItem item={item} />;
  }

  let body: JSX.Element;
  if (col.type === 'number') {
    const values = answered.map((r) => Number(r.answers[col.id])).filter((n) => Number.isFinite(n));
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    const fmt = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 2 });
    body =
      avg == null ? (
        <p className="text-sm text-text-tertiary">—</p>
      ) : (
        <dl className="grid grid-cols-3 gap-2 text-center">
          {[
            [t('surveyMin'), fmt(Math.min(...values))],
            [t('surveyAverage'), fmt(avg)],
            [t('surveyMax'), fmt(Math.max(...values))],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-surface-subtle py-2">
              <dt className="text-xs text-text-tertiary">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      );
  } else if (col.type === 'file') {
    const list = responses.flatMap((r) => files(r));
    body = (
      <div className="space-y-1">
        {list.length === 0 && <p className="text-sm text-text-tertiary">—</p>}
        {list.slice(0, all ? undefined : 8).map((f) => (
          <FileLink key={f.id} id={f.id} name={f.file_name} size={f.size} locale={locale} />
        ))}
        {list.length > 8 && !all && <MoreButton onClick={() => setAll(true)} n={list.length - 8} />}
      </div>
    );
  } else {
    const list = answered.filter((r) => text(r, col).trim());
    body = (
      <ul className="space-y-1.5">
        {list.length === 0 && <li className="text-sm text-text-tertiary">—</li>}
        {list.slice(0, all ? undefined : 8).map((r) => (
          <li key={r.id} className="flex items-start gap-2 rounded-lg bg-surface-subtle px-2.5 py-1.5 text-sm">
            <span className="min-w-0 flex-1 whitespace-pre-line break-words">{text(r, col)}</span>
            {FREE_TEXT.includes(col.type) && (
              <ReviewToggle on={r.reviewed.includes(col.id)} onClick={() => void onReview(r, col.id)} />
            )}
          </li>
        ))}
        {list.length > 8 && !all && <MoreButton onClick={() => setAll(true)} n={list.length - 8} />}
      </ul>
    );
  }
  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h3 className="font-medium">{col.title}</h3>
      <p className="mb-3 text-xs text-text-tertiary">{t('formAnsweredCount').replace('{n}', String(answered.length))}</p>
      {body}
    </section>
  );
};

const MoreButton = ({ onClick, n }: { onClick: () => void; n: number }) => {
  const { t } = useI18n();
  return (
    <button type="button" onClick={onClick} className="text-sm font-medium text-text-secondary hover:text-text">
      {t('showMore')} ({n})
    </button>
  );
};

const ReviewToggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={on ? t('surveyReviewed') : t('surveyMarkReviewed')}
      className={cn(
        'inline-flex h-7 flex-shrink-0 items-center gap-1 rounded-full px-2 text-xs',
        on ? 'bg-success-soft text-success-strong' : 'text-text-tertiary hover:bg-surface-hover',
      )}
    >
      <CheckCircle2 size={12} />
      {on ? t('surveyReviewed') : t('surveyMarkReviewed')}
    </button>
  );
};

// A response's file, opened through the guarded route (managers only).
const FileLink = ({ id, name, size, locale }: { id: string; name: string; size: number; locale: string }) => (
  <a
    href={`/api/forms/file/${id}`}
    target="_blank"
    rel="noopener noreferrer"
    className="mt-1 flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm hover:bg-surface-subtle"
  >
    <Paperclip size={13} className="flex-shrink-0 text-text-tertiary" />
    <span className="min-w-0 flex-1 truncate">{name}</span>
    <span className="text-xs tabular-nums text-text-tertiary">{formatBytes(size, locale)}</span>
  </a>
);
