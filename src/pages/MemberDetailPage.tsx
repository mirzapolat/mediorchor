import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil } from 'lucide-react';
import { Card } from '@/components/Card';
import { Avatar } from '@/components/Avatar';
import { PageSpinner } from '@/components/Spinner';
import { MemberForm } from '@/components/MemberForm';
import { StatusBadge } from '@/components/StatusBadge';
import { DataTable } from '@/components/DataTable';
import { TableFilterMenu, useTableFilters } from '@/components/TableFilterMenu';
import { HeaderAction } from '@/components/HeaderAction';
import { useI18n } from '@/lib/i18n';
import { accountNameDeviation } from '@/lib/accountName';
import { api } from '@/lib/api';
import { useProjectContext } from '@/layouts/projectContext';
import type { AttendanceDisplayStatus, AttendanceStatus, Event, Member } from '@/types';
import { useProjectGroups } from '@/hooks/useProjectGroups';
import { isHeld, localToday } from '@/lib/eventTiming';
import { GroupPill } from '@/components/GroupPill';

// One row per Probe of the project, whether or not anything is recorded.
interface HistoryRow {
  event: Event;
  status: AttendanceDisplayStatus;
  upcoming: boolean;
  is_guest: boolean;
}

// Past (and undated) Proben: stored status, no record = absent. Today and
// later: excused, marked present ("expected"; today: checked in = present) or
// nothing yet ("upcoming").
const displayStatus = (event: Event, status: AttendanceStatus | undefined): AttendanceDisplayStatus => {
  const today = localToday();
  if (isHeld(event.date, today)) return status ?? 'not_attended';
  if (status === 'excused') return 'excused';
  if (status === 'attended') return event.date === today ? 'attended' : 'expected';
  return 'upcoming';
};

export const MemberDetailPage = () => {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const { names: groups } = useProjectGroups();
  const { memberId } = useParams();
  const navigate = useNavigate();
  const [member, setMember] = useState<Member | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [accountName, setAccountName] = useState<string | undefined>(undefined);
  const tf = useTableFilters();

  const load = async () => {
    const { data: m } = await api.from('members').select('*').eq('id', memberId).maybeSingle();
    setMember((m as Member) ?? null);

    // Name of the linked account (if any), to flag a deviating member name.
    const { data: names } = await api.rpc('linked_account_names', {
      p_project_id: project.id,
    });
    setAccountName(
      ((names as { member_id: string; account_name: string }[] | null) ?? []).find(
        (row) => row.member_id === memberId,
      )?.account_name,
    );

    const [{ data: events }, { data: att }] = await Promise.all([
      api.from('events').select('*').eq('project_id', project.id),
      api.from('attendance').select('event_id, status, is_guest').eq('member_id', memberId),
    ]);
    const records = new Map(
      ((att as { event_id: string; status: AttendanceStatus; is_guest: boolean }[] | null) ?? []).map(
        (r) => [r.event_id, r],
      ),
    );
    const today = localToday();
    const rows: HistoryRow[] = ((events as Event[] | null) ?? [])
      .map((event) => {
        const record = records.get(event.id);
        return {
          event,
          status: displayStatus(event, record?.status),
          upcoming: !isHeld(event.date, today),
          is_guest: record?.is_guest ?? false,
        };
      })
      .sort((a, b) =>
        a.event.date === b.event.date
          ? (a.event.time ?? '').localeCompare(b.event.time ?? '')
          : (a.event.date ?? '').localeCompare(b.event.date ?? ''),
      );
    setHistory(rows);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  if (loading) return <PageSpinner />;
  if (!member) {
    navigate(`/projects/${project.id}/members`);
    return null;
  }

  const filters = tf.bind<HistoryRow>([
    {
      id: 'status',
      label: t('attendance'),
      options: [
        { value: 'attended', label: t('attended') },
        { value: 'excused', label: t('excused') },
        { value: 'not_attended', label: t('notAttended') },
        { value: 'expected', label: t('expectedStatus') },
        { value: 'upcoming', label: t('upcomingStatus') },
      ],
      predicate: (h, v) => h.status === v,
    },
    {
      id: 'timeframe',
      label: t('timeframe'),
      options: [
        { value: 'past', label: t('past') },
        { value: 'upcoming', label: t('upcoming') },
      ],
      predicate: (h, v) => (v === 'upcoming' ? h.upcoming : !h.upcoming),
    },
  ]);

  // The counters cover Proben that have taken place; upcoming ones are listed
  // below but only count once they're held.
  const held = history.filter((h) => !h.upcoming);
  const attendedCount = held.filter((h) => h.status === 'attended').length;

  return (
    <>
      <button
        onClick={() => navigate(`/projects/${project.id}/members`)}
        className="flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-text transition-colors duration-150 mb-6"
      >
        <ArrowLeft size={16} />
        {t('members')}
      </button>

      <div className="flex items-start justify-between gap-3 mb-6 sm:gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <Avatar name={`${member.first_name} ${member.last_name}`} photoUrl={member.photo_url} size={64} />
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold break-words">
              {member.first_name} {member.last_name}
            </h1>
            {accountNameDeviation(member, accountName) && (
              <p className="text-sm text-accent mt-1 break-words">
                {t('nameDiffersFromAccount')}: {accountNameDeviation(member, accountName)}
              </p>
            )}
            <p className="flex flex-wrap items-center gap-2 text-text-secondary text-sm mt-1 break-words">
              {member.group_name && <GroupPill name={member.group_name} />}
              {member.email ?? '—'}
            </p>
          </div>
        </div>
        <div className="flex-shrink-0">
          <HeaderAction icon={Pencil} label={t('edit')} variant="secondary" onClick={() => setEditOpen(true)} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card>
          <p className="text-sm text-text-secondary">{t('attended')}</p>
          <p className="text-2xl font-bold mt-1">{attendedCount}</p>
        </Card>
        <Card>
          <p className="text-sm text-text-secondary">{t('excused')}</p>
          <p className="text-2xl font-bold mt-1">
            {held.filter((h) => h.status === 'excused').length}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-text-secondary">{t('events')}</p>
          <p className="text-2xl font-bold mt-1">{held.length}</p>
        </Card>
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('attendance')}</h2>
        <TableFilterMenu query={tf.query} onQueryChange={tf.setQuery} filters={filters} />
      </div>
      <DataTable
        rows={history}
        getRowId={(h) => h.event.id}
        onRowClick={(h) => navigate(`/projects/${project.id}/events/${h.event.id}`)}
        search={(h) => h.event.name}
        query={tf.query}
        hideToolbar
        emptyMessage={t('noResults')}
        filters={filters}
        columns={[
          {
            id: 'event',
            header: t('eventName'),
            accessor: (h) => h.event.name,
            render: (h) => (
              <span className="inline-flex items-center gap-2">
                {h.event.name}
                {h.is_guest && (
                  <span className="text-xs text-text-tertiary border border-border rounded-md px-1.5 py-0.5">
                    {t('guest')}
                  </span>
                )}
              </span>
            ),
          },
          {
            id: 'date',
            header: t('date'),
            accessor: (h) => h.event.date,
            render: (h) => <span className="text-text-secondary">{h.event.date ?? '—'}</span>,
          },
          {
            id: 'status',
            header: t('attendance'),
            accessor: (h) => h.status,
            render: (h) => <StatusBadge status={h.status} />,
          },
        ]}
      />

      <MemberForm
        open={editOpen}
        projectId={project.id}
        member={member}
        groups={groups}
        onClose={() => setEditOpen(false)}
        onSaved={load}
      />
    </>
  );
};
