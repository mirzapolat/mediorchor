import { Star, Trophy } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { localeOf } from '@shared/languages';
import type { FormSummary, FormSummaryItem } from '@/lib/forms';
import type { RunoffResult } from '@shared/forms';

// Answer counts as percentage bars: a choice's share, its number behind it.
export const PercentBars = ({ rows, total }: { rows: { key: string; label: string; count: number }[]; total: number }) => {
  const { lang } = useI18n();
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => {
        const share = total ? r.count / total : 0;
        return (
          <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-sm">
            <span className="min-w-0 truncate" title={r.label}>
              {r.label}
            </span>
            <span className="tabular-nums text-text-secondary">
              {r.count} · {Math.round(share * 100).toLocaleString(localeOf(lang))} %
            </span>
            <span className="col-span-2 block h-2 overflow-hidden rounded-full bg-surface-muted">
              <span
                className={cn('block h-full rounded-full', r.count === max && r.count > 0 ? 'bg-accent' : 'bg-chart-1')}
                style={{ width: `${share * 100}%` }}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
};

// A ranked choice result: who won (or the tie), then the votes of each
// option per round of the instant runoff — dropped options fade out.
const RunoffTable = ({ options, runoff }: { options: { id: string; label: string }[]; runoff: RunoffResult }) => {
  const { t } = useI18n();
  const label = (id: string) => options.find((o) => o.id === id)?.label ?? id;
  const { rounds, winner, tied } = runoff;
  const last = rounds[rounds.length - 1];
  if (!last || last.active === 0) return <p className="text-sm text-text-tertiary">—</p>;
  // Strongest first: by the round each option lasted to, then its votes there.
  const lasted = (id: string) => rounds.findIndex((r) => r.eliminated.includes(id));
  const order = [...options].sort((a, b) => {
    const la = lasted(a.id) === -1 ? rounds.length : lasted(a.id);
    const lb = lasted(b.id) === -1 ? rounds.length : lasted(b.id);
    const ra = rounds[Math.min(la, rounds.length - 1)].counts[a.id] ?? 0;
    const rb = rounds[Math.min(lb, rounds.length - 1)].counts[b.id] ?? 0;
    return lb - la || rb - ra;
  });
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 rounded-xl bg-surface-subtle px-3 py-2 text-sm">
        <Trophy size={15} className="flex-shrink-0 text-accent" aria-hidden />
        {winner ? (
          <span className="min-w-0">
            <span className="font-semibold">{label(winner)}</span>{' '}
            <span className="text-text-secondary">
              {t('rankingWinner')
                .replace('{votes}', String(last.counts[winner] ?? 0))
                .replace('{active}', String(last.active))
                .replace('{round}', String(rounds.length))}
            </span>
          </span>
        ) : (
          <span className="min-w-0">
            {t('rankingTie')} <span className="font-semibold">{tied.map(label).join(', ')}</span>
          </span>
        )}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-text-tertiary">
              <th className="py-1 pr-3 text-left font-medium">{t('rankingOption')}</th>
              {rounds.map((_, i) => (
                <th key={i} className="w-14 px-1 py-1 text-right font-medium tabular-nums">
                  {t('rankingRound').replace('{n}', String(i + 1))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.map((o) => {
              const out = lasted(o.id);
              return (
                <tr key={o.id} className="border-t border-border">
                  <td className={cn('max-w-0 truncate py-1.5 pr-3', o.id === winner && 'font-semibold')} title={o.label}>
                    {o.label}
                  </td>
                  {rounds.map((r, i) => (
                    <td
                      key={i}
                      className={cn(
                        'px-1 py-1.5 text-right tabular-nums',
                        out !== -1 && i > out
                          ? 'text-text-tertiary'
                          : i === out
                            ? 'text-text-tertiary line-through'
                            : o.id === winner && i === rounds.length - 1
                              ? 'font-semibold text-accent'
                              : 'text-text-secondary',
                      )}
                    >
                      {out !== -1 && i > out ? '' : (r.counts[o.id] ?? 0)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-text-tertiary">{t('rankingExplain')}</p>
    </div>
  );
};

// One question of a summary: bars per option, scale value or grid cell.
export const SummaryItem = ({ item }: { item: FormSummaryItem }) => {
  const { t, lang } = useI18n();
  const locale = localeOf(lang);
  let body: JSX.Element | null = null;
  if (item.type === 'single' || item.type === 'multi' || item.type === 'dropdown') {
    body = (
      <PercentBars
        total={item.answered}
        rows={(item.options ?? []).map((o) => ({ key: o.id, label: o.label, count: item.counts[o.id] ?? 0 }))}
      />
    );
  } else if (item.type === 'ranking' && item.runoff) {
    body = <RunoffTable options={item.options ?? []} runoff={item.runoff} />;
  } else if (item.type === 'yesno') {
    body = (
      <PercentBars
        total={item.answered}
        rows={[
          { key: 'true', label: t('yes'), count: item.counts.true ?? 0 },
          { key: 'false', label: t('no'), count: item.counts.false ?? 0 },
        ]}
      />
    );
  } else if (item.type === 'scale' || item.type === 'stars') {
    const from = item.type === 'stars' ? 1 : (item.scale_min ?? 1);
    const to = item.scale_max ?? 5;
    const values = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    const sum = values.reduce((s, v) => s + v * (item.counts[String(v)] ?? 0), 0);
    const average = item.answered ? sum / item.answered : null;
    const max = Math.max(1, ...values.map((v) => item.counts[String(v)] ?? 0));
    body = (
      <div>
        {average != null && (
          <p className="mb-2 flex items-center gap-1.5 text-sm text-text-secondary">
            {item.type === 'stars' && <Star size={14} className="fill-accent text-accent" />}
            {t('formAverage').replace('{n}', average.toLocaleString(locale, { maximumFractionDigits: 1 }))}
          </p>
        )}
        <div className="flex h-24 items-end gap-1.5" role="img" aria-label={item.title}>
          {values.map((v) => {
            const count = item.counts[String(v)] ?? 0;
            return (
              <div key={v} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <span className="text-[10px] tabular-nums text-text-tertiary">{count || ''}</span>
                <span className="w-full rounded-t-md bg-chart-1" style={{ height: `${(count / max) * 64 + 2}px` }} />
                <span className="text-xs tabular-nums text-text-secondary">{v}</span>
              </div>
            );
          })}
        </div>
        {(item.min_label || item.max_label) && (
          <div className="mt-1 flex justify-between text-xs text-text-tertiary">
            <span>{item.min_label}</span>
            <span>{item.max_label}</span>
          </div>
        )}
      </div>
    );
  } else if (item.type === 'grid') {
    body = (
      <div className="space-y-3">
        {(item.rows ?? []).map((row) => (
          <div key={row.id}>
            <p className="mb-1 text-sm font-medium text-text-secondary">{row.label}</p>
            <PercentBars
              total={(item.columns ?? []).reduce((s, c) => s + (item.counts[`${row.id}:${c.id}`] ?? 0), 0)}
              rows={(item.columns ?? []).map((c) => ({ key: c.id, label: c.label, count: item.counts[`${row.id}:${c.id}`] ?? 0 }))}
            />
          </div>
        ))}
      </div>
    );
  }
  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h3 className="font-medium">{item.title}</h3>
      <p className="mb-3 text-xs text-text-tertiary">{t('formAnsweredCount').replace('{n}', String(item.answered))}</p>
      {body}
    </section>
  );
};

// The participants' summary: counts only, and only from a minimum number of
// responses on (so nobody can be singled out).
export const ParticipantSummary = ({ summary }: { summary: FormSummary }) => {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('formSummaryTitle')}</h2>
      {summary.too_few ? (
        <p className="rounded-2xl border border-dashed border-border-strong px-4 py-5 text-center text-sm text-text-secondary">
          {t('formSummaryTooFew').replace('{n}', String(summary.min))}
        </p>
      ) : (
        <>
          <p className="text-sm text-text-secondary">{t('formResponsesTotal').replace('{n}', String(summary.total))}</p>
          {summary.items.map((item) => (
            <SummaryItem key={item.id} item={item} />
          ))}
        </>
      )}
    </div>
  );
};
