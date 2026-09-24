import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, Table2 } from 'lucide-react';
import { Card } from './Card';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

type Range = '7d' | '30d' | '90d' | '12m';
type Kind = 'account' | 'reminder' | 'status' | 'weekly' | 'test';

interface Bucket {
  key: string; // YYYY-MM-DD or YYYY-MM, in the viewer's local time
  sent: Record<Kind, number>;
  failed: number;
}

interface MailStats {
  range: Range;
  bucket: 'day' | 'month';
  kinds: Kind[];
  buckets: Bucket[];
  totals: { sent: number; failed: number; by_kind: Record<Kind, number>; failed_by_kind: Record<Kind, number> };
  previous: { sent: number; failed: number };
  last_sent_at: string | null;
  last_failed: { at: string; error: string } | null;
  errors: { error: string; count: number }[];
}

// Fixed kind → series slot: color follows the kind, never its rank or which
// kinds happen to be present (tokens in index.css, validated for CVD).
const SERIES: Record<Kind, { color: string; swatch: string; label: TranslationKey }> = {
  account: { color: 'bg-chart-1', swatch: 'bg-chart-1', label: 'mailKindAccount' },
  reminder: { color: 'bg-chart-2', swatch: 'bg-chart-2', label: 'mailKindReminder' },
  status: { color: 'bg-chart-3', swatch: 'bg-chart-3', label: 'mailKindStatus' },
  weekly: { color: 'bg-chart-4', swatch: 'bg-chart-4', label: 'mailKindWeekly' },
  test: { color: 'bg-chart-5', swatch: 'bg-chart-5', label: 'mailKindTest' },
};

const RANGES: { value: Range; label: TranslationKey }[] = [
  { value: '7d', label: 'range7d' },
  { value: '30d', label: 'range30d' },
  { value: '90d', label: 'range90d' },
  { value: '12m', label: 'range12m' },
];

const PLOT_HEIGHT = 200;

// Round step so the y-axis gets 3–5 gridlines.
const niceScale = (max: number) => {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  const step = steps.find((s) => max / s <= 4) ?? Math.ceil(max / 4);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
};

// Bucket key → local Date (keys are already local calendar dates).
const bucketDate = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d ?? 1);
};

const sumSent = (b: Bucket) => Object.values(b.sent).reduce((a, n) => a + n, 0);

// Admin → Email: how many emails went out when, by kind, and how that
// develops. Aggregates only — the log stores no recipients or content.
export const MailStatsCard = () => {
  const { t, lang } = useI18n();
  const [range, setRange] = useState<Range>(() => {
    try {
      const saved = localStorage.getItem('admin.mailStats.range');
      return saved === '7d' || saved === '30d' || saved === '90d' || saved === '12m' ? saved : '30d';
    } catch {
      return '30d';
    }
  });
  const [stats, setStats] = useState<MailStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asTable, setAsTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void api.functions
      .invoke('admin-mail-stats', { body: { range, tz_offset: -new Date().getTimezoneOffset() } })
      .then(({ data, error: loadError }) => {
        if (cancelled) return;
        if (loadError) setError(loadError.message);
        else setStats(data as MailStats);
      });
    try {
      localStorage.setItem('admin.mailStats.range', range);
    } catch {
      /* storage unavailable */
    }
    return () => {
      cancelled = true;
    };
  }, [range]);

  const locale = lang === 'de' ? 'de-DE' : 'en-US';
  const fmt = useMemo(
    () => ({
      number: new Intl.NumberFormat(locale),
      percent: new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }),
      day: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }),
      dayLong: new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }),
      month: new Intl.DateTimeFormat(locale, { month: 'short' }),
      monthLong: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }),
      dateTime: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    }),
    [locale],
  );

  const rangeControl = (
    <div role="radiogroup" aria-label={t('timeRange')} className="flex rounded-md border border-border p-0.5">
      {RANGES.map((r) => (
        <button
          key={r.value}
          type="button"
          role="radio"
          aria-checked={range === r.value}
          onClick={() => setRange(r.value)}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors duration-150',
            range === r.value ? 'bg-surface-hover text-text' : 'text-text-secondary hover:text-text',
          )}
        >
          {t(r.label)}
        </button>
      ))}
    </div>
  );

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-medium">{t('mailStats')}</h2>
        <p className="mt-1 text-sm text-text-secondary">{t('mailStatsHint')}</p>
      </div>
      {rangeControl}
    </div>
  );

  if (error) {
    return (
      <Card className="space-y-4">
        {header}
        <p className="text-sm text-danger-strong">{error}</p>
      </Card>
    );
  }
  if (!stats) {
    return (
      <Card className="space-y-4">
        {header}
        <div className="h-[280px] animate-pulse rounded-md bg-surface-muted" />
      </Card>
    );
  }

  const { totals, previous, buckets, kinds } = stats;
  const attempts = totals.sent + totals.failed;
  const successRate = attempts ? totals.sent / attempts : null;
  const change = previous.sent ? (totals.sent - previous.sent) / previous.sent : null;
  const { top, ticks } = niceScale(Math.max(1, ...buckets.map(sumSent)));
  const labelOf = (key: string) => (stats.bucket === 'day' ? fmt.day : fmt.month).format(bucketDate(key));
  const longLabelOf = (key: string) => (stats.bucket === 'day' ? fmt.dayLong : fmt.monthLong).format(bucketDate(key));
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 8));
  const hovered = hover !== null ? buckets[hover] : null;

  return (
    <Card className="space-y-5">
      {header}

      {/* Headline numbers for the chosen range. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('mailsSent')} value={fmt.number.format(totals.sent)}>
          {change !== null ? (
            <span className="inline-flex items-center gap-0.5">
              {change >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
              {t('vsPreviousPeriod').replace('{change}', `${change >= 0 ? '+' : ''}${fmt.percent.format(change)}`)}
            </span>
          ) : previous.sent === 0 && totals.sent > 0 ? (
            t('noPreviousPeriod')
          ) : null}
        </Stat>
        <Stat label={t('mailsFailed')} value={fmt.number.format(totals.failed)}>
          {totals.failed > 0 ? (
            <span className="inline-flex items-center gap-1 text-danger-strong">
              <AlertTriangle size={12} />
              {t('mailsFailedHint')}
            </span>
          ) : null}
        </Stat>
        <Stat
          label={t('mailSuccessRate')}
          value={successRate === null ? '—' : fmt.percent.format(successRate)}
        />
        <Stat
          label={t('mailLastSent')}
          value={stats.last_sent_at ? fmt.dateTime.format(new Date(stats.last_sent_at)) : '—'}
          small
        />
      </div>

      {attempts === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border py-12 text-center">
          <BarChart3 size={22} className="text-text-tertiary" />
          <p className="text-sm text-text-secondary">{t('noMailsInRange')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Legend: always present for the series; color never alone. */}
            <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-text-secondary">
              {kinds.map((k) => (
                <li key={k} className="inline-flex items-center gap-1.5">
                  <span className={cn('h-2.5 w-2.5 rounded-[3px]', SERIES[k].swatch)} />
                  {t(SERIES[k].label)}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setAsTable((v) => !v)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary transition-colors hover:text-text"
            >
              {asTable ? <BarChart3 size={15} /> : <Table2 size={15} />}
              {asTable ? t('showChart') : t('showTable')}
            </button>
          </div>

          {asTable ? (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-subtle text-left text-text-secondary">
                  <tr>
                    <th className="px-3 py-2 font-medium">{stats.bucket === 'day' ? t('day') : t('month')}</th>
                    {kinds.map((k) => (
                      <th key={k} className="px-3 py-2 text-right font-medium">
                        {t(SERIES[k].label)}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right font-medium">{t('sumTotal')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('mailsFailed')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border tabular-nums">
                  {[...buckets].reverse().filter((b) => sumSent(b) + b.failed > 0).map((b) => (
                    <tr key={b.key}>
                      <td className="whitespace-nowrap px-3 py-2">{longLabelOf(b.key)}</td>
                      {kinds.map((k) => (
                        <td key={k} className="px-3 py-2 text-right text-text-secondary">
                          {b.sent[k] || '—'}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-medium">{sumSent(b)}</td>
                      <td className={cn('px-3 py-2 text-right', b.failed ? 'text-danger-strong' : 'text-text-tertiary')}>
                        {b.failed || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="relative flex gap-2 pt-3">
              {/* Y axis: recessive tick labels. */}
              <div className="relative w-8 flex-shrink-0 text-right text-xs tabular-nums text-text-tertiary" style={{ height: PLOT_HEIGHT }}>
                {ticks.map((v) => (
                  <span key={v} className="absolute right-0 translate-y-1/2" style={{ bottom: `${(v / top) * 100}%` }}>
                    {fmt.number.format(v)}
                  </span>
                ))}
              </div>
              <div className="min-w-0 flex-1">
                <div className="relative" style={{ height: PLOT_HEIGHT }} onMouseLeave={() => setHover(null)}>
                  {/* Gridlines. */}
                  {ticks.map((v) => (
                    <div
                      key={v}
                      className={cn('absolute inset-x-0 border-t', v === 0 ? 'border-border-strong' : 'border-border')}
                      style={{ bottom: `${(v / top) * 100}%` }}
                    />
                  ))}
                  {/* Bars: one column per bucket; the whole column is the hover target. */}
                  <div className="absolute inset-0 flex items-end gap-[2px]">
                    {buckets.map((b, i) => {
                      const total = sumSent(b);
                      const present = kinds.filter((k) => b.sent[k] > 0);
                      return (
                        <div
                          key={b.key}
                          onMouseEnter={() => setHover(i)}
                          className={cn('flex h-full min-w-0 flex-1 flex-col justify-end', hover === i && 'bg-surface-muted/70')}
                        >
                          <div
                            className="mx-auto flex w-full max-w-[28px] flex-col-reverse gap-[2px]"
                            style={{ height: `${(total / top) * 100}%` }}
                          >
                            {present.map((k, idx) => (
                              <div
                                key={k}
                                className={cn(
                                  SERIES[k].color,
                                  idx === present.length - 1 && 'rounded-t-[4px]',
                                  'min-h-[2px]',
                                )}
                                style={{ flexGrow: b.sent[k], flexBasis: 0 }}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {hovered && hover !== null ? (
                    <div
                      role="status"
                      className="pointer-events-none absolute top-2 z-10 w-52 rounded-lg border border-border bg-surface p-3 text-sm shadow-lg"
                      style={
                        hover < buckets.length / 2
                          ? { left: `calc(${((hover + 1) / buckets.length) * 100}% + 8px)` }
                          : { right: `calc(${((buckets.length - hover) / buckets.length) * 100}% + 8px)` }
                      }
                    >
                      <p className="mb-2 font-medium">{longLabelOf(hovered.key)}</p>
                      <ul className="space-y-1">
                        {kinds.map((k) => (
                          <li key={k} className="flex items-center justify-between gap-3 text-text-secondary">
                            <span className="inline-flex items-center gap-1.5">
                              <span className={cn('h-2 w-2 rounded-[2px]', SERIES[k].swatch)} />
                              {t(SERIES[k].label)}
                            </span>
                            <span className="tabular-nums text-text">{hovered.sent[k]}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 flex justify-between border-t border-border pt-2 font-medium">
                        <span>{t('sumTotal')}</span>
                        <span className="tabular-nums">{sumSent(hovered)}</span>
                      </div>
                      {hovered.failed > 0 ? (
                        <div className="mt-1 flex items-center justify-between text-danger-strong">
                          <span className="inline-flex items-center gap-1">
                            <AlertTriangle size={12} />
                            {t('mailsFailed')}
                          </span>
                          <span className="tabular-nums">{hovered.failed}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {/* Failures: a small status marker under each affected column, outside
                    the plot so bar heights stay true to the gridlines. */}
                <div className="mt-1 flex h-1 gap-[2px]" aria-hidden>
                  {buckets.map((b) => (
                    <span key={b.key} className="flex min-w-0 flex-1 justify-center">
                      {b.failed > 0 ? <span className="h-1 w-1 rounded-full bg-danger" /> : null}
                    </span>
                  ))}
                </div>
                {/* X axis labels, thinned so they never collide. */}
                <div className="mt-1 flex gap-[2px] text-xs text-text-tertiary">
                  {buckets.map((b, i) => (
                    <span key={b.key} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">
                      {i % labelEvery === 0 ? labelOf(b.key) : ''}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Per-kind breakdown (also the chart's text alternative). */}
          <div className="grid grid-cols-1 gap-x-8 gap-y-1.5 border-t border-border pt-4 text-sm sm:grid-cols-2">
            {kinds.map((k) => (
              <div key={k} className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-text-secondary">
                  <span className={cn('h-2.5 w-2.5 rounded-[3px]', SERIES[k].swatch)} />
                  {t(SERIES[k].label)}
                </span>
                <span className="tabular-nums">
                  {fmt.number.format(totals.by_kind[k])}
                  {totals.failed_by_kind[k] ? (
                    <span className="ml-2 text-danger-strong">
                      {t('failedCount').replace('{n}', fmt.number.format(totals.failed_by_kind[k]))}
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>

          {stats.errors.length > 0 ? (
            <div className="rounded-md bg-danger-soft px-3 py-2.5 text-sm text-danger-strong">
              <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangle size={14} />
                {t('mailErrors')}
              </p>
              <p className="mt-1">
                {stats.errors.map((e) => `${e.error} (${e.count}×)`).join(' · ')}
                {stats.last_failed
                  ? ` — ${t('mailLastFailed').replace('{date}', fmt.dateTime.format(new Date(stats.last_failed.at)))}`
                  : ''}
              </p>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
};

const Stat = ({
  label,
  value,
  small,
  children,
}: {
  label: string;
  value: string;
  small?: boolean;
  children?: ReactNode;
}) => (
  <div className="rounded-md border border-border bg-surface-subtle px-3.5 py-3">
    <p className="text-xs font-medium text-text-secondary">{label}</p>
    <p className={cn('mt-1 font-semibold tabular-nums', small ? 'text-sm' : 'text-2xl')}>{value}</p>
    {children ? <p className="mt-0.5 text-xs text-text-secondary">{children}</p> : null}
  </div>
);
