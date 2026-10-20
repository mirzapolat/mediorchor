import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ChevronRight, Loader2 } from 'lucide-react';
import { GroupPill } from '@/components/GroupPill';
import { NoAccess } from '@/components/NoAccess';
import { usePieceLayout } from '@/layouts/PieceLayout';
import { usePieceScope } from '@/layouts/pieceScope';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { localeOf } from '@shared/languages';

// What server/trainingReport.ts returns.
interface ReportMeasure {
  index: number;
  label: string;
  people: number;
  tries: number;
  accuracy: number | null;
  good: number;
  ok: number;
  flat: number;
  sharp: number;
  silent: number;
  bias: number | null;
}
interface Report {
  minPeople: number;
  members: number;
  trained: number;
  runs: number;
  practiceMinutes: number;
  lastRunAt: number | null;
  overall: { mastery: number; latest: number; buckets: number[] } | null;
  // trained/runs are null for groups too small to show them anonymously.
  groups: Array<{ name: string | null; color: string | null; members: number; trained: number | null; runs: number | null; mastery: number | null }>;
  tracks: Array<{ id: string; name: string; people: number; runs: number; bars: number; measures: ReportMeasure[] }>;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;
// A bar sits from here on (as the trainer's "known" bars).
const SITS = 0.85;

// Accuracy as a theme colour: sits, wobbles, needs work.
const tone = (v: number | null) =>
  v == null ? 'bg-surface-muted' : v >= SITS ? 'bg-success' : v >= 0.6 ? 'bg-accent' : 'bg-danger';
const toneText = (v: number | null) =>
  v == null ? 'text-text-tertiary' : v >= SITS ? 'text-success-strong' : v >= 0.6 ? 'text-text' : 'text-danger';

// How far a bar's figure can be trusted: by the people and tries behind it.
const confidence = (people: number, tries: number): 1 | 2 | 3 => (people >= 8 && tries >= 20 ? 3 : people >= 5 ? 2 : 1);

// A thin horizontal bar (0..1).
const Meter = ({ value, className }: { value: number; className?: string }) => (
  <span className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
    <span className={cn('block h-full rounded-full', className)} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
  </span>
);

// A piece's "Auswertung" for the project's managers: how far the members
// have got with it, anonymous (see server/trainingReport.ts). Read top to
// bottom like a short report: what it rests on, how well the piece sits and
// how that spreads over the people, the groups, then bar by bar what goes
// well or wrong and how — each with how much data stands behind it.
export const PieceReportPage = () => {
  const { t, lang } = useI18n();
  const locale = localeOf(lang);
  const { projectId, canManageProject, base } = usePieceScope();
  const { piece } = usePieceLayout();
  // Only while the piece has training (as its "Training" page); without it
  // an old link leads back to the piece and asks for no report.
  const canTrain = piece.trainer_file_id != null;
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [barIndex, setBarIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!projectId || !canManageProject || !canTrain) return;
    void api.rpc('piece_training_report', { p_project_id: projectId, p_piece_id: piece.id }).then(({ data, error: rpcError }) => {
      if (rpcError) return setError(rpcError.message);
      const r = data as Report;
      setReport(r);
      setTrackId(r.tracks[0]?.id ?? null);
    });
  }, [projectId, canManageProject, canTrain, piece.id]);

  const track = report?.tracks.find((x) => x.id === trackId) ?? null;
  const sung = useMemo(() => (track?.measures ?? []).filter((m) => m.accuracy != null), [track]);
  // Below the "sits" line, weakest first; from it on, strongest first.
  const weakest = useMemo(
    () => sung.filter((m) => (m.accuracy ?? 0) < SITS).sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0)).slice(0, 5),
    [sung],
  );
  const strongest = useMemo(
    () => sung.filter((m) => (m.accuracy ?? 0) >= SITS).sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0)).slice(0, 5),
    [sung],
  );
  const bar = track?.measures.find((m) => m.index === barIndex) ?? weakest[0] ?? null;

  if (!canTrain) return <Navigate to={`${base}/${piece.id}`} replace />;
  if (!projectId || !canManageProject) return <NoAccess />;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!report) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={20} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  const practised =
    report.practiceMinutes >= 60
      ? t('reportHours').replace('{n}', (report.practiceMinutes / 60).toLocaleString(locale, { maximumFractionDigits: 1 }))
      : t('reportMinutes').replace('{n}', String(report.practiceMinutes));
  const basis = [
    t('reportBasisPeople').replace('{n}', String(report.trained)).replace('{total}', String(report.members)),
    t('reportBasisRuns').replace('{n}', String(report.runs)),
    practised,
    report.lastRunAt
      ? t('reportBasisLast').replace('{date}', new Date(report.lastRunAt).toLocaleDateString(locale, { day: 'numeric', month: 'long' }))
      : null,
  ].filter(Boolean);

  // What mostly goes wrong in a bar, in a few words.
  const cause = (m: ReportMeasure) => {
    if ((m.accuracy ?? 0) >= SITS) return t('reportCauseSolid');
    if (m.silent >= 0.25) return t('reportCauseSilent');
    if (Math.max(m.flat, m.sharp) >= 0.15) {
      const cents = m.bias != null && Math.abs(m.bias) >= 5 ? ` · Ø ${Math.round(Math.abs(m.bias))} Cent` : '';
      return (m.flat >= m.sharp ? t('reportCauseFlat') : t('reportCauseSharp')) + cents;
    }
    if (m.ok >= 0.3) return t('reportCauseClose');
    return t('reportCauseMixed');
  };

  const peopleTries = (m: ReportMeasure) =>
    t('reportPeopleTries').replace('{people}', String(m.people)).replace('{tries}', String(m.tries));

  const confidenceOf = (m: ReportMeasure) => {
    const level = confidence(m.people, m.tries);
    const label = t(level === 3 ? 'reportConfidenceHigh' : level === 2 ? 'reportConfidenceMedium' : 'reportConfidenceLow');
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-text-tertiary" title={`${label}: ${peopleTries(m)}`}>
        <span className="flex gap-0.5" aria-hidden>
          {[1, 2, 3].map((d) => (
            <span key={d} className={cn('h-1.5 w-1.5 rounded-full', d <= level ? 'bg-text-secondary' : 'bg-border-strong')} />
          ))}
        </span>
        <span className="sr-only">{label}</span>
        {peopleTries(m)}
      </span>
    );
  };

  const sectionTitle = 'text-xs font-semibold uppercase tracking-wide text-text-tertiary';
  type Group = Report['groups'][number];
  const groupTooFew = t('reportGroupTooFew').replace('{min}', String(report.minPeople));
  const groupName = (g: Group) =>
    g.name ? (
      <span className="min-w-0 truncate">
        <GroupPill name={g.name} color={g.color ?? undefined} />
      </span>
    ) : (
      <span className="truncate text-text-secondary">{t('reportNoGroup')}</span>
    );
  const practisedCell = (g: Group) =>
    g.trained != null ? (
      <div className="flex items-center gap-3">
        <span className="w-12 flex-shrink-0 whitespace-nowrap tabular-nums">
          {g.trained}/{g.members}
        </span>
        <Meter value={g.members ? g.trained / g.members : 0} className="bg-text-secondary" />
      </div>
    ) : (
      <span className="block truncate text-xs text-text-tertiary" title={groupTooFew}>
        {t('reportSmallGroup')}
      </span>
    );
  const sitsCell = (g: Group) =>
    g.mastery != null ? (
      <div className="flex items-center gap-3">
        <span className={cn('w-12 flex-shrink-0 whitespace-nowrap font-medium tabular-nums', toneText(g.mastery))}>{pct(g.mastery)}</span>
        <Meter value={g.mastery} className={tone(g.mastery)} />
      </div>
    ) : (
      <span className="block truncate text-xs text-text-tertiary" title={groupTooFew}>
        {t('reportGroupTooFewShort')}
      </span>
    );
  const outcomes = [
    ['good', 'bg-success', 'reportOutcomeGood'],
    ['ok', 'bg-success/50', 'reportOutcomeClose'],
    ['flat', 'bg-chart-1', 'reportOutcomeFlat'],
    ['sharp', 'bg-danger', 'reportOutcomeSharp'],
    ['silent', 'bg-border-strong', 'reportOutcomeSilent'],
  ] as const;

  return (
    <div className="max-w-5xl space-y-12 pb-12">
      <header className="space-y-2">
        <h1 className="text-xl font-bold sm:text-2xl">{t('reportTitle')}</h1>
        <p className="text-sm text-text-secondary">{t('reportIntro')}</p>
        <p className="text-sm">
          <span className="text-text-tertiary">{t('reportBasis')} </span>
          {basis.join(' · ')}
        </p>
      </header>

      {report.trained === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-6 py-12 text-center text-sm text-text-secondary">
          {t('reportNobody')}
        </p>
      ) : (
        <>
          {/* How well the piece sits, and how that spreads over the people. */}
          <section className="space-y-5">
            <h2 className={sectionTitle}>{t('reportStateTitle')}</h2>
            {report.overall ? (
              <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
                <div>
                  <p className={cn('text-5xl font-bold tabular-nums leading-none sm:text-6xl', toneText(report.overall.mastery))}>
                    {pct(report.overall.mastery)}
                  </p>
                  <p className="mt-2 text-base font-medium">{t('reportMasteryLabel')}</p>
                  <p className="mt-1 max-w-sm text-sm text-text-secondary">{t('reportMasteryHint')}</p>
                  <p className="mt-4 text-sm text-text-secondary">
                    {t('reportLatest').replace('{pct}', pct(report.overall.latest))}
                  </p>
                </div>
                <div>
                  <p className="mb-3 text-sm text-text-secondary">{t('reportSpread').replace('{n}', String(report.trained))}</p>
                  <ul className="space-y-2.5">
                    {(['reportBucket0', 'reportBucket1', 'reportBucket2', 'reportBucket3'] as const).map((key, i) => {
                      const n = report.overall?.buckets[i] ?? 0;
                      return (
                        <li key={key} className="grid grid-cols-[5.5rem_minmax(0,1fr)_1.5rem] sm:grid-cols-[6.5rem_minmax(0,1fr)_2rem] items-center gap-3 text-sm">
                          <span className="text-text-secondary">{t(key)}</span>
                          <Meter
                            value={report.trained ? n / report.trained : 0}
                            className={i === 3 ? 'bg-success' : i === 2 ? 'bg-success/60' : i === 1 ? 'bg-accent' : 'bg-danger'}
                          />
                          <span className="text-right tabular-nums">{n}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="rounded-xl bg-surface-muted px-4 py-3 text-sm text-text-secondary">
                {t('reportTooFew').replace('{min}', String(report.minPeople)).replace('{n}', String(report.trained))}
              </p>
            )}
            <div className="max-w-md space-y-1.5">
              <p className="text-sm">
                {t('reportParticipation').replace('{n}', String(report.trained)).replace('{total}', String(report.members))}
              </p>
              <Meter value={report.members ? report.trained / report.members : 0} className="bg-text-secondary" />
            </div>
          </section>

          {/* The groups. */}
          {report.groups.length > 0 && (
            <section className="space-y-3">
              <h2 className={sectionTitle}>{t('reportGroupsTitle')}</h2>
              {/* Phones: one card row per group, the figures side by side. */}
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface sm:hidden">
                {report.groups.map((g) => (
                  <li key={g.name ?? '—'} className="space-y-3 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      {groupName(g)}
                      {g.runs != null && (
                        <span className="flex-shrink-0 text-xs tabular-nums text-text-tertiary">
                          {g.runs} {t('reportRuns')}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="min-w-0 space-y-1">
                        <p className="text-xs text-text-tertiary">{t('reportPractised')}</p>
                        {practisedCell(g)}
                      </div>
                      <div className="min-w-0 space-y-1">
                        <p className="text-xs text-text-tertiary">{t('reportSits')}</p>
                        {sitsCell(g)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-hidden rounded-2xl border border-border bg-surface sm:block">
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <tr className="bg-surface-subtle text-left text-xs text-text-secondary">
                      <th className="h-10 px-4 font-medium">{t('reportGroup')}</th>
                      <th className="h-10 w-[30%] px-4 font-medium">{t('reportPractised')}</th>
                      <th className="h-10 w-[30%] px-4 font-medium">{t('reportSits')}</th>
                      <th className="h-10 w-24 px-4 text-right font-medium">{t('reportRuns')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.groups.map((g) => (
                      <tr key={g.name ?? '—'} className="border-t border-border">
                        <td className="px-4 py-3">{groupName(g)}</td>
                        <td className="px-4 py-3">{practisedCell(g)}</td>
                        <td className="px-4 py-3">{sitsCell(g)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{g.runs ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Bar by bar, per voice. */}
          {report.tracks.length > 0 && (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className={sectionTitle}>{t('reportBarsTitle')}</h2>
                {report.tracks.length > 1 && (
                  <div role="tablist" aria-label={t('voicesTitle')} className="flex flex-wrap gap-1 rounded-lg bg-surface-muted p-1">
                    {report.tracks.map((x) => (
                      <button
                        key={x.id}
                        type="button"
                        role="tab"
                        aria-selected={x.id === trackId}
                        onClick={() => {
                          setTrackId(x.id);
                          setBarIndex(null);
                        }}
                        className={cn(
                          'h-8 rounded-md px-3 text-sm transition-colors duration-150',
                          x.id === trackId ? 'bg-surface font-medium shadow-sm' : 'text-text-secondary hover:text-text',
                        )}
                      >
                        {x.name}
                        <span className="ml-1.5 text-xs text-text-tertiary">{x.people}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {track && track.measures.length === 0 ? (
                <p className="rounded-xl bg-surface-muted px-4 py-3 text-sm text-text-secondary">
                  {t('reportVoiceTooFew')
                    .replace('{voice}', track.name)
                    .replace('{n}', String(track.people))
                    .replace('{min}', String(report.minPeople))}
                </p>
              ) : track ? (
                <>
                  {/* One cell per bar: its colour is how well it sits. */}
                  <div className="rounded-2xl border border-border bg-surface p-4">
                    <div className="flex items-end gap-px overflow-x-auto pb-1">
                      {track.measures.map((m, i) => {
                        const active = bar?.index === m.index;
                        // On phones only every fourth number (and the chosen one) fits.
                        const labelled = active || i % 4 === 0 || i === track.measures.length - 1;
                        return (
                          <button
                            key={m.index}
                            type="button"
                            onClick={() => setBarIndex(m.index)}
                            title={`${t('reportBar')} ${m.label}: ${m.accuracy != null ? pct(m.accuracy) : t('reportNotSung')}`}
                            className="group flex min-w-[0.875rem] flex-1 flex-col items-center gap-1"
                          >
                            <span
                              className={cn(
                                'block h-10 w-full rounded-sm transition-opacity duration-150',
                                tone(m.accuracy),
                                m.accuracy != null && 'opacity-80 group-hover:opacity-100',
                                active && 'opacity-100 ring-2 ring-black ring-offset-1',
                              )}
                            />
                            <span
                              className={cn(
                                'text-[10px] tabular-nums',
                                active ? 'font-semibold text-text' : 'text-text-tertiary',
                                !labelled && 'invisible sm:visible',
                              )}
                            >
                              {m.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-tertiary">
                      {(
                        [
                          ['bg-success', 'reportLegendSits'],
                          ['bg-accent', 'reportLegendWobbles'],
                          ['bg-danger', 'reportLegendNeedsWork'],
                          ['bg-surface-muted', 'reportNotSung'],
                        ] as const
                      ).map(([cls, key]) => (
                        <span key={key} className="inline-flex items-center gap-1.5">
                          <span className={cn('h-2 w-2 rounded-sm', cls)} />
                          {t(key)}
                        </span>
                      ))}
                    </p>
                  </div>

                  {/* The chosen bar: what happens there, and how much stands behind it. */}
                  {bar && (
                    <div className="grid gap-6 rounded-2xl border border-border bg-surface p-4 sm:p-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                      <div>
                        <p className="text-sm text-text-secondary">
                          {t('reportBar')} {bar.label}
                        </p>
                        <p className={cn('mt-1 text-4xl font-bold tabular-nums', toneText(bar.accuracy))}>
                          {bar.accuracy != null ? pct(bar.accuracy) : '—'}
                        </p>
                        <p className="mt-1 text-sm">{bar.accuracy != null ? cause(bar) : t('reportNotSung')}</p>
                        <div className="mt-3">{confidenceOf(bar)}</div>
                      </div>
                      {bar.accuracy != null && (
                        <div className="space-y-2">
                          <p className="text-xs text-text-tertiary">{t('reportOutcomes')}</p>
                          <div className="flex h-3 overflow-hidden rounded-full bg-surface-muted">
                            {outcomes.map(([k, cls]) => (
                              <span key={k} className={cls} style={{ width: `${bar[k] * 100}%` }} />
                            ))}
                          </div>
                          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                            {outcomes.map(([k, cls, key]) => (
                              <li key={k} className="flex items-center gap-2">
                                <span className={cn('h-2 w-2 flex-shrink-0 rounded-sm', cls)} />
                                <span className="text-text-secondary">{t(key)}</span>
                                <span className="ml-auto tabular-nums">{pct(bar[k])}</span>
                              </li>
                            ))}
                          </ul>
                          {bar.bias != null && Math.abs(bar.bias) >= 5 && (
                            <p className="text-xs text-text-secondary">
                              {t(bar.bias < 0 ? 'reportBiasFlat' : 'reportBiasSharp').replace('{cents}', String(Math.round(Math.abs(bar.bias))))}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Where to rehearse, and what already sits. */}
                  <div className="grid gap-6 md:grid-cols-2">
                    {(
                      [
                        ['reportNeedsWork', weakest],
                        ['reportSitsWell', strongest],
                      ] as const
                    ).map(([key, list]) => (
                      <div key={key} className="space-y-2">
                        <h3 className="text-sm font-semibold">{t(key)}</h3>
                        {list.length === 0 ? (
                          <p className="text-sm text-text-tertiary">—</p>
                        ) : (
                          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                            {list.map((m) => (
                              <li key={m.index}>
                                <button
                                  type="button"
                                  onClick={() => setBarIndex(m.index)}
                                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-subtle sm:px-4"
                                >
                                  <span className="w-14 flex-shrink-0 text-sm font-medium sm:w-16">
                                    {t('reportBar')} {m.label}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm">{cause(m)}</span>
                                    {confidenceOf(m)}
                                  </span>
                                  <span className={cn('flex-shrink-0 text-sm font-semibold tabular-nums', toneText(m.accuracy))}>
                                    {m.accuracy != null ? pct(m.accuracy) : '—'}
                                  </span>
                                  <ChevronRight size={15} className="flex-shrink-0 text-text-tertiary" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </section>
          )}
        </>
      )}

      {/* How it is computed, for those who want to know. */}
      <details className="group rounded-2xl border border-border bg-surface-subtle text-sm [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-medium text-text-secondary hover:text-text">
          <ChevronRight size={15} className="transition-transform duration-150 group-open:rotate-90" />
          {t('reportMethodTitle')}
        </summary>
        <div className="space-y-2 border-t border-border px-4 py-3 text-text-secondary">
          <p>{t('reportMethodMastery')}</p>
          <p>{t('reportMethodBars')}</p>
          <p>{t('reportMethodConfidence')}</p>
          <p>{t('reportMethodPrivacy').replace('{min}', String(report.minPeople))}</p>
        </div>
      </details>
    </div>
  );
};
