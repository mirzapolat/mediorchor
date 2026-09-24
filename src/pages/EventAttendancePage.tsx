import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, UserPlus } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { Avatar } from '@/components/Avatar';
import { PageSpinner } from '@/components/Spinner';
import { DataTable, type Column } from '@/components/DataTable';
import { TableFilterMenu, useTableFilters } from '@/components/TableFilterMenu';
import { HeaderAction } from '@/components/HeaderAction';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useEventContext } from '@/layouts/eventContext';
import type { AttendanceStatus, Member } from '@/types';
import { useProjectGroups } from '@/hooks/useProjectGroups';
import { GroupPill } from '@/components/GroupPill';
import { isHeld } from '@/lib/eventTiming';

interface Row {
  member: Member;
  // null = nothing recorded for an upcoming Probe (not yet missed).
  status: AttendanceStatus | null;
  is_guest: boolean;
}

const STATUSES: AttendanceStatus[] = ['attended', 'excused', 'not_attended'];

export const EventAttendancePage = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { project, event } = useEventContext();
  const { names: groups } = useProjectGroups();
  const eventId = event.id;
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const tf = useTableFilters();
  // Until the Probe has taken place, no record means "open", not absent.
  const held = isHeld(event.date);

  const load = async () => {
    const [{ data: members }, { data: attendance }] = await Promise.all([
      api.from('members').select('*').eq('project_id', project.id).eq('status', 'active'),
      api
        .from('attendance')
        .select('status, is_guest, members(*)')
        .eq('event_id', eventId),
    ]);

    const attRows = (attendance as unknown as Array<{
      status: AttendanceStatus;
      is_guest: boolean;
      members: Member;
    }>) ?? [];
    const attByMember = new Map(attRows.filter((a) => a.members).map((a) => [a.members.id, a]));

    const activeMembers = (members as Member[]) ?? [];
    const merged: Row[] = activeMembers.map((m) => {
      const a = attByMember.get(m.id);
      return { member: m, status: a?.status ?? (held ? 'not_attended' : null), is_guest: false };
    });

    // Guest members only surface on the event they were added to.
    for (const a of attRows) {
      if (a.members && a.is_guest && !merged.some((r) => r.member.id === a.members.id)) {
        merged.push({ member: a.members, status: a.status, is_guest: true });
      }
    }

    merged.sort((a, b) =>
      `${a.member.last_name}${a.member.first_name}`.localeCompare(
        `${b.member.last_name}${b.member.first_name}`,
      ),
    );
    setRows(merged);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, project.id]);

  const setStatus = async (row: Row, status: AttendanceStatus) => {
    // Optimistic update.
    setRows((rs) => rs.map((r) => (r.member.id === row.member.id ? { ...r, status } : r)));
    await api.from('attendance').upsert(
      {
        event_id: eventId,
        member_id: row.member.id,
        status,
        is_guest: row.is_guest,
      },
      { onConflict: 'event_id,member_id' },
    );
  };

  const counts = useMemo(
    () => ({
      attended: rows.filter((r) => r.status === 'attended').length,
      excused: rows.filter((r) => r.status === 'excused').length,
      total: rows.length,
    }),
    [rows],
  );


  if (loading) return <PageSpinner />;

  const columns: Column<Row>[] = [
    {
      id: 'name',
      header: t('name'),
      accessor: (r) => `${r.member.last_name} ${r.member.first_name}`,
      render: (r) => (
        <div className="flex items-center gap-3 min-w-0">
          <Avatar
            name={`${r.member.first_name} ${r.member.last_name}`}
            photoUrl={r.member.photo_url}
            size={32}
          />
          <span className="flex items-center gap-2 truncate">
            {r.member.first_name} {r.member.last_name}
            {r.is_guest && (
              <span className="text-xs text-text-tertiary border border-border rounded-md px-1.5 py-0.5">
                {t('guest')}
              </span>
            )}
          </span>
        </div>
      ),
    },
    {
      id: 'group',
      header: t('group'),
      accessor: (r) => r.member.group_name,
      render: (r) => <GroupPill name={r.member.group_name} />,
    },
    {
      id: 'status',
      header: t('attendance'),
      accessor: (r) => r.status,
      className: 'w-px whitespace-nowrap',
      render: (r) => (
        <div className="flex items-center rounded-md border border-border overflow-hidden w-fit">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={(e: MouseEvent) => {
                e.stopPropagation();
                void setStatus(r, s);
              }}
              className={cn(
                'px-3 py-1.5 text-sm font-medium transition-colors duration-150 border-l border-border first:border-l-0',
                r.status === s
                  ? s === 'attended'
                    ? 'bg-success text-white'
                    : s === 'excused'
                      ? 'bg-accent text-white'
                      : 'bg-surface-hover text-text'
                  : 'bg-white text-text-secondary hover:bg-surface-muted',
              )}
            >
              {s === 'attended' ? t('attended') : s === 'excused' ? t('excused') : t('notAttended')}
            </button>
          ))}
        </div>
      ),
    },
  ];

  const filters = tf.bind<Row>([
    {
      id: 'status',
      label: t('attendance'),
      options: [
        { value: 'attended', label: t('attended') },
        { value: 'excused', label: t('excused') },
        { value: 'not_attended', label: t('notAttended') },
        ...(held ? [] : [{ value: 'open', label: t('upcomingStatus') }]),
      ],
      predicate: (r, v) => (v === 'open' ? r.status === null : r.status === v),
    },
    {
      id: 'group',
      label: t('group'),
      options: groups.map((g) => ({ value: g, label: g })),
      predicate: (r, v) => r.member.group_name === v,
    },
  ]);

  return (
    <>
      <PageHeader
        title={t('attendance')}
        subtitle={`${counts.attended} ${t('attended').toLowerCase()} · ${counts.excused} ${t('excused').toLowerCase()} · ${counts.total} ${t('total')}`}
        inlineActions
        actions={
          <>
            <TableFilterMenu query={tf.query} onQueryChange={tf.setQuery} filters={filters} />
            <HeaderAction icon={UserPlus} label={t('addMemberToEvent')} onClick={() => setAddOpen(true)} />
          </>
        }
      />

      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(r) => r.member.id}
        onRowClick={(r) => navigate(`/projects/${project.id}/members/${r.member.id}`)}
        search={(r) => `${r.member.first_name} ${r.member.last_name}`}
        filters={filters}
        query={tf.query}
        hideToolbar
        emptyMessage={t('noMembers')}
      />

      <AddPersonModal
        open={addOpen}
        projectId={project.id}
        eventId={eventId!}
        onClose={() => setAddOpen(false)}
        onAdded={load}
      />
    </>
  );
};

// Adds a new person to this event, asking whether they should be a one-off guest
// or a permanent project member.
const AddPersonModal = ({
  open,
  projectId,
  eventId,
  onClose,
  onAdded,
}: {
  open: boolean;
  projectId: string;
  eventId: string;
  onClose: () => void;
  onAdded: () => void;
}) => {
  const { t } = useI18n();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [saving, setSaving] = useState(false);

  const add = async (asGuest: boolean) => {
    setSaving(true);
    const { data: member } = await api
      .from('members')
      .insert({
        project_id: projectId,
        first_name: first.trim(),
        last_name: last.trim(),
        status: asGuest ? 'guest' : 'active',
      })
      .select()
      .single();

    if (member) {
      await api.from('attendance').insert({
        event_id: eventId,
        member_id: (member as Member).id,
        status: 'attended',
        is_guest: asGuest,
      });
    }
    setSaving(false);
    setFirst('');
    setLast('');
    onAdded();
    onClose();
  };

  const valid = first.trim() && last.trim();

  return (
    <Modal open={open} title={t('addMemberToEvent')} onClose={onClose}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-3">
          <Input label={t('firstName')} value={first} onChange={(e) => setFirst(e.target.value)} autoFocus />
          <Input label={t('lastName')} value={last} onChange={(e) => setLast(e.target.value)} />
        </div>
        <p className="text-sm text-text-secondary">{t('guestOrMember')}</p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            disabled={!valid || saving}
            onClick={() => add(true)}
          >
            <Plus size={15} />
            {t('addAsGuest')}
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={!valid || saving}
            onClick={() => add(false)}
          >
            <UserPlus size={15} />
            {t('addToProject')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
