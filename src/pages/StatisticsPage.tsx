import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Select } from '@/components/Input';
import { EmptyState } from '@/components/EmptyState';
import { PageSpinner } from '@/components/Spinner';
import { AttendanceChart, type ChartColumn, type ChartSeries } from '@/components/AttendanceChart';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { FALLBACK_GROUP_COLOR, isHexColor } from '@/lib/groupColors';
import { useProjectContext } from '@/layouts/projectContext';
import { useProjectGroups } from '@/hooks/useProjectGroups';
import type { AttendanceStatus, MemberStatus } from '@/types';

// Series key for members whose group is empty or unknown.
const NO_GROUP = '__none';

interface EventRow {
  id: string;
  name: string;
  date: string;
}

interface AttendanceRow {
  event_id: string;
  member_id: string;
  status: AttendanceStatus;
}

interface MemberRow {
  id: string;
  group_name: string | null;
  status: MemberStatus;
}

export const StatisticsPage = () => {
  const { t, lang } = useI18n();
  const { project } = useProjectContext();
  const { groups, find: findGroup } = useProjectGroups();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [groupFilter, setGroupFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [eventsResult, attendanceResult, membersResult] = await Promise.all([
      api
        .from('events')
        .select('id, name, date')
        .eq('project_id', project.id)
        .not('date', 'is', null)
        .order('date', { ascending: true }),
      api
        .from('attendance')
        .select('event_id, member_id, status, events!inner(project_id)')
        .eq('events.project_id', project.id),
      api.from('members').select('id, group_name, status').eq('project_id', project.id),
    ]);
    setEvents((eventsResult.data as EventRow[] | null) ?? []);
    setAttendance((attendanceResult.data as AttendanceRow[] | null) ?? []);
    setMembers((membersResult.data as MemberRow[] | null) ?? []);
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const groupKeyOf = useCallback(
    (groupName: string | null) => findGroup(groupName)?.id ?? NO_GROUP,
    [findGroup],
  );

  // All series in the configured group order, "No group" last.
  const allSeries = useMemo<ChartSeries[]>(
    () => [
      ...groups.map((g) => ({
        key: g.id,
        label: g.name,
        color: isHexColor(g.color) ? g.color : FALLBACK_GROUP_COLOR,
      })),
      { key: NO_GROUP, label: t('noGroupAssigned'), color: '', muted: true },
    ],
    [groups, t],
  );

  const memberGroup = useMemo(
    () => new Map(members.map((m) => [m.id, groupKeyOf(m.group_name)])),
    [members, groupKeyOf],
  );

  const rosterByGroup = useMemo(() => {
    const roster: Record<string, number> = {};
    for (const m of members) {
      if (m.status !== 'active') continue;
      const key = groupKeyOf(m.group_name);
      roster[key] = (roster[key] ?? 0) + 1;
    }
    return roster;
  }, [members, groupKeyOf]);

  // Per event and group: present / excused counts.
  const byEvent = useMemo(() => {
    const map: Record<string, Record<string, { present: number; excused: number }>> = {};
    for (const row of attendance) {
      if (row.status !== 'attended' && row.status !== 'excused') continue;
      const key = memberGroup.get(row.member_id) ?? NO_GROUP;
      const cell = ((map[row.event_id] ??= {})[key] ??= { present: 0, excused: 0 });
      if (row.status === 'attended') cell.present += 1;
      else cell.excused += 1;
    }
    return map;
  }, [attendance, memberGroup]);

  // Groups offered in the dropdown: every configured group, plus "No group"
  // when there are members without one.
  const hasNoGroup =
    (rosterByGroup[NO_GROUP] ?? 0) > 0 ||
    attendance.some((a) => memberGroup.get(a.member_id) === NO_GROUP);
  const filterOptions = allSeries.filter((s) => !s.muted || hasNoGroup);
  const activeFilter = filterOptions.some((s) => s.key === groupFilter) ? groupFilter : '';

  const series = useMemo(
    () => (activeFilter ? allSeries.filter((s) => s.key === activeFilter) : allSeries),
    [allSeries, activeFilter],
  );

  const columns = useMemo<ChartColumn[]>(
    () =>
      events.map((ev) => {
        const cells = byEvent[ev.id] ?? {};
        const present: Record<string, number> = {};
        let excused = 0;
        const keys = series.map((s) => s.key);
        for (const key of keys) {
          present[key] = cells[key]?.present ?? 0;
          excused += cells[key]?.excused ?? 0;
        }
        const roster = keys.reduce((sum, key) => sum + (rosterByGroup[key] ?? 0), 0);
        return { id: ev.id, name: ev.name, date: ev.date, present, excused, roster };
      }),
    [events, byEvent, rosterByGroup, series],
  );

  const summary = useMemo(() => {
    let attended = 0;
    let excused = 0;
    let possible = 0;
    for (const c of columns) {
      const present = Object.values(c.present).reduce((a, b) => a + b, 0);
      attended += present;
      excused += c.excused;
      possible += Math.max(c.roster, present + c.excused);
    }
    return {
      attended,
      excused,
      averagePresent: columns.length ? attended / columns.length : 0,
      attendanceRate: possible ? Math.round((attended / possible) * 100) : 0,
    };
  }, [columns]);

  // Attendance rate per group across all rehearsals — also the table view of
  // the chart's colours.
  const groupRates = useMemo(
    () =>
      allSeries
        .map((s) => {
          let present = 0;
          let possible = 0;
          for (const ev of events) {
            const cell = byEvent[ev.id]?.[s.key];
            const p = cell?.present ?? 0;
            present += p;
            possible += Math.max(rosterByGroup[s.key] ?? 0, p + (cell?.excused ?? 0));
          }
          return { series: s, present, possible, rate: possible ? present / possible : 0 };
        })
        .filter((r) => r.possible > 0),
    [allSeries, events, byEvent, rosterByGroup],
  );

  const percent = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', {
    style: 'percent',
    maximumFractionDigits: 0,
  });
  const decimal = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', {
    maximumFractionDigits: 1,
  });

  if (loading) return <PageSpinner />;

  return (
    <>
      <PageHeader
        title={t('statistics')}
        actions={
          events.length > 0 && filterOptions.length > 1 ? (
            <div className="min-w-[200px]">
              <Select
                aria-label={t('group')}
                value={activeFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
              >
                <option value="">{t('allGroups')}</option>
                {filterOptions.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : undefined
        }
      />

      {events.length === 0 ? (
        <EmptyState icon={BarChart3} message={t('noStatistics')} />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label={t('attendanceRate')} value={`${summary.attendanceRate}%`} />
            <StatCard label={t('averagePresent')} value={decimal.format(summary.averagePresent)} />
            <StatCard label={t('totalAttendances')} value={String(summary.attended)} />
            <StatCard label={t('totalExcuses')} value={String(summary.excused)} />
          </div>

          <Card className="mb-6">
            <div className="mb-4">
              <h2 className="font-semibold">{t('attendanceOverTime')}</h2>
              <p className="mt-1 text-sm text-text-secondary">{t('attendanceChartHint')}</p>
            </div>
            <AttendanceChart columns={columns} series={series} />
          </Card>

          {!activeFilter && groupRates.length > 1 && (
            <Card>
              <h2 className="mb-4 font-semibold">{t('attendanceRateByGroup')}</h2>
              <ul className="space-y-3">
                {groupRates.map(({ series: s, present, possible, rate }) => (
                  <li key={s.key}>
                    <button
                      type="button"
                      onClick={() => setGroupFilter(s.key)}
                      className="group grid w-full grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-left text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 flex-shrink-0 rounded-[3px]"
                          style={
                            s.muted
                              ? { background: 'repeating-linear-gradient(45deg, #cfcfcf 0 2px, #ececec 2px 5px)' }
                              : { backgroundColor: s.color }
                          }
                        />
                        <span className="truncate text-text-secondary group-hover:text-text">{s.label}</span>
                      </span>
                      <span className="h-2 overflow-hidden rounded-full bg-[#f2f2f2]">
                        <span
                          className="block h-full origin-left animate-[growx_600ms_cubic-bezier(0.2,0.8,0.2,1)_both] rounded-full"
                          style={{
                            width: `${rate * 100}%`,
                            ...(s.muted
                              ? { background: 'repeating-linear-gradient(45deg, #cfcfcf 0 2px, #ececec 2px 5px)' }
                              : { backgroundColor: s.color }),
                          }}
                        />
                      </span>
                      <span className="w-24 text-right tabular-nums">
                        <span className="font-semibold text-text">{percent.format(rate)}</span>
                        <span className="ml-1.5 text-xs text-text-tertiary">
                          {present}/{possible}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  );
};

const StatCard = ({ label, value }: { label: string; value: string }) => (
  <Card>
    <p className="text-sm text-text-secondary">{label}</p>
    <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
  </Card>
);
