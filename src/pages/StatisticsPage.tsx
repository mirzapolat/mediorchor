import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { PageSpinner } from '@/components/Spinner';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { useProjectContext } from '@/layouts/projectContext';
import type { AttendanceStatus } from '@/types';

interface EventStat {
  id: string;
  name: string;
  date: string;
  attended: number;
  excused: number;
  absent: number;
}

const COLORS = {
  attended: '#16a34a',
  excused: '#efa100',
  absent: '#e5e5e5',
};

export const StatisticsPage = () => {
  const { t, lang } = useI18n();
  const { project } = useProjectContext();
  const [stats, setStats] = useState<EventStat[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [eventsResult, attendanceResult, membersResult] = await Promise.all([
      supabase
        .from('events')
        .select('id, name, date')
        .eq('project_id', project.id)
        .not('date', 'is', null)
        .order('date', { ascending: true }),
      supabase
        .from('attendance')
        .select('event_id, status, events!inner(project_id)')
        .eq('events.project_id', project.id),
      supabase
        .from('members')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', project.id)
        .eq('status', 'active'),
    ]);

    const counts: Record<string, { attended: number; excused: number }> = {};
    for (const row of (attendanceResult.data as Array<{
      event_id: string;
      status: AttendanceStatus;
    }> | null) ?? []) {
      const entry = (counts[row.event_id] ??= { attended: 0, excused: 0 });
      if (row.status === 'attended') entry.attended += 1;
      else if (row.status === 'excused') entry.excused += 1;
    }

    const base = membersResult.count ?? 0;
    const events = (eventsResult.data as Array<{ id: string; name: string; date: string }> | null) ?? [];
    setMemberCount(base);
    setStats(
      events.map((ev) => {
        const c = counts[ev.id] ?? { attended: 0, excused: 0 };
        return {
          id: ev.id,
          name: ev.name,
          date: ev.date,
          attended: c.attended,
          excused: c.excused,
          absent: Math.max(0, base - c.attended - c.excused),
        };
      }),
    );
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-US', { day: '2-digit', month: '2-digit' }),
    [lang],
  );
  const fullDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-US', { dateStyle: 'medium' }),
    [lang],
  );

  const summary = useMemo(() => {
    const totalAttended = stats.reduce((sum, s) => sum + s.attended, 0);
    const totalExcused = stats.reduce((sum, s) => sum + s.excused, 0);
    const totalAbsent = stats.reduce((sum, s) => sum + s.absent, 0);
    const denom = totalAttended + totalExcused + totalAbsent;
    return {
      totalAttended,
      totalExcused,
      averagePresent: stats.length ? totalAttended / stats.length : 0,
      attendanceRate: denom ? Math.round((totalAttended / denom) * 100) : 0,
    };
  }, [stats]);

  const maxTotal = useMemo(
    () => Math.max(1, memberCount, ...stats.map((s) => s.attended + s.excused + s.absent)),
    [stats, memberCount],
  );

  if (loading) return <PageSpinner />;

  return (
    <>
      <PageHeader title={t('statistics')} />

      {stats.length === 0 ? (
        <EmptyState icon={BarChart3} message={t('noStatistics')} />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label={t('attendanceRate')} value={`${summary.attendanceRate}%`} />
            <StatCard label={t('averagePresent')} value={summary.averagePresent.toFixed(1)} />
            <StatCard label={t('totalAttendances')} value={String(summary.totalAttended)} />
            <StatCard label={t('totalExcuses')} value={String(summary.totalExcused)} />
          </div>

          <Card>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">{t('attendanceOverTime')}</h2>
              <div className="flex items-center gap-4 text-sm text-text-secondary">
                <LegendDot color={COLORS.attended} label={t('attended')} />
                <LegendDot color={COLORS.excused} label={t('excused')} />
                <LegendDot color={COLORS.absent} label={t('notAttended')} />
              </div>
            </div>

            <div className="overflow-x-auto pb-1">
              <div className="flex h-64 min-w-full gap-1.5">
                {stats.map((s) => {
                  const total = s.attended + s.excused + s.absent;
                  const remainder = Math.max(0, maxTotal - total);
                  return (
                    <div
                      key={s.id}
                      className="flex min-w-[34px] max-w-[64px] flex-1 flex-col items-center gap-2"
                      title={`${s.name} · ${fullDateFormatter.format(new Date(s.date))}\n${t('attended')}: ${s.attended} · ${t('excused')}: ${s.excused} · ${t('notAttended')}: ${s.absent}`}
                    >
                      <div className="flex w-full flex-1 flex-col-reverse overflow-hidden rounded-t-sm">
                        <Segment value={s.attended} color={COLORS.attended} />
                        <Segment value={s.excused} color={COLORS.excused} />
                        <Segment value={s.absent} color={COLORS.absent} />
                        {remainder > 0 ? (
                          <div style={{ flexGrow: remainder, flexBasis: 0 }} />
                        ) : null}
                      </div>
                      <span className="whitespace-nowrap text-[11px] text-text-tertiary">
                        {dateFormatter.format(new Date(s.date))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        </>
      )}
    </>
  );
};

const StatCard = ({ label, value }: { label: string; value: string }) => (
  <Card>
    <p className="text-sm text-text-secondary">{label}</p>
    <p className="mt-1 text-2xl font-bold">{value}</p>
  </Card>
);

const LegendDot = ({ color, label }: { color: string; label: string }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
    {label}
  </span>
);

const Segment = ({ value, color }: { value: number; color: string }) =>
  value > 0 ? (
    <div style={{ flexGrow: value, flexBasis: 0, backgroundColor: color }} />
  ) : null;
