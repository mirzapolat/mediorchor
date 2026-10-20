import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, StickyNote, Trash2, Users, UserRoundCheck } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageSpinner } from '@/components/Spinner';
import { Avatar } from '@/components/Avatar';
import { DataTable, renderCell, type Column, type FilterDef } from '@/components/DataTable';
import { MobilePerson } from '@/components/MobilePerson';
import { GroupPill } from '@/components/GroupPill';
import { GroupForm } from '@/components/GroupForm';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useProjectContext } from '@/layouts/projectContext';
import { useProjectGroups } from '@/hooks/useProjectGroups';
import { useGroupResponsibilities } from '@/lib/groupResponsibles';
import type { GroupResponsible, Member } from '@/types';

export const GroupDetailPage = () => {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const { groups, loaded, reload: reloadGroups } = useProjectGroups();
  const { groupId } = useParams();
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const responsibilities = useGroupResponsibilities(project.id);

  const group = groups.find((g) => g.id === groupId);
  const backToList = () => navigate(`/projects/${project.id}/groups`);

  const load = useCallback(async () => {
    if (!group) return;
    const { data } = await api
      .from('members')
      .select('*')
      .eq('project_id', project.id)
      .in('status', ['active', 'archived'])
      .order('last_name');
    // Group names match case-insensitively, like everywhere else.
    setMembers(
      ((data as Member[] | null) ?? []).filter(
        (m) => m.group_name?.toLowerCase() === group.name.toLowerCase(),
      ),
    );
    setLoading(false);
  }, [project.id, group]);

  useEffect(() => {
    void load();
  }, [load]);

  // Unknown (e.g. just deleted) group: back to the list.
  useEffect(() => {
    if (loaded && !group) navigate(`/projects/${project.id}/groups`, { replace: true });
  }, [loaded, group, navigate, project.id]);

  const remove = async () => {
    if (!group) return;
    await api.from('project_groups').delete().eq('id', group.id);
    await reloadGroups();
    backToList();
  };

  if (!group || loading) return <PageSpinner />;

  const activeCount = members.filter((m) => m.status === 'active').length;

  const columns: Column<Member>[] = [
    {
      id: 'first_name',
      header: t('firstName'),
      accessor: (m) => m.first_name,
      render: (m) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={`${m.first_name} ${m.last_name}`} photoUrl={m.photo_url} size={28} />
          <span>{m.first_name}</span>
        </div>
      ),
    },
    {
      id: 'last_name',
      header: t('lastName'),
      accessor: (m) => m.last_name,
      render: (m) => <span>{m.last_name || '—'}</span>,
    },
    {
      id: 'email',
      header: t('email'),
      accessor: (m) => m.email,
      render: (m) => <span className="text-text-secondary">{m.email ?? '—'}</span>,
    },
    {
      id: 'status',
      header: t('status'),
      accessor: (m) => (m.status === 'active' ? 0 : 1),
      render: (m) =>
        m.status === 'active' ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success-strong">
            <span className="h-2 w-2 rounded-full bg-success" />
            {t('active')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary">
            <span className="h-2 w-2 rounded-full bg-text-tertiary" />
            {t('archived')}
          </span>
        ),
      className: 'w-px whitespace-nowrap',
    },
  ];

  const filters: FilterDef<Member>[] = [
    {
      id: 'status',
      label: t('status'),
      options: [
        { value: 'active', label: t('active') },
        { value: 'archived', label: t('archived') },
      ],
      predicate: (m, v) => m.status === v,
    },
  ];

  return (
    <>
      <button
        onClick={backToList}
        className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text"
      >
        <ArrowLeft size={16} />
        {t('groupsList')}
      </button>

      <PageHeader
        title={group.name}
        subtitle={`${activeCount} ${t('groupMemberCount').toLowerCase()}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(true)}>
              <Pencil size={16} />
              {t('edit')}
            </Button>
            <Button variant="secondary" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={16} />
              {t('delete')}
            </Button>
          </>
        }
      />

      <div className="mb-4">
        <GroupPill name={group.name} color={group.color} className="text-sm" />
      </div>

      <ResponsibilityCard
        people={responsibilities.byGroup.get(group.id) ?? []}
        note={responsibilities.notes.get(group.id) ?? ''}
        onEdit={() => setFormOpen(true)}
      />

      <DataTable
        rows={members}
        columns={columns}
        getRowId={(m) => m.id}
        onRowClick={(m) => navigate(`/projects/${project.id}/members/${m.id}`)}
        search={(m) => `${m.first_name} ${m.last_name} ${m.email ?? ''}`}
        filters={filters}
        emptyMessage={t('noMembersInGroup')}
        emptyIcon={Users}
        // Phones: photo and full name, email and status below.
        mobileCard={(m) => (
          <MobilePerson
            avatar={<Avatar name={`${m.first_name} ${m.last_name}`} photoUrl={m.photo_url} size={36} />}
            name={`${m.first_name} ${m.last_name}`.trim()}
          >
            {m.email && <span className="min-w-0 break-all">{m.email}</span>}
            {renderCell(columns, 'status', m)}
          </MobilePerson>
        )}
      />

      <GroupForm
        open={formOpen}
        projectId={project.id}
        group={group}
        groups={groups}
        responsibility={{
          people: responsibilities.byGroup.get(group.id) ?? [],
          note: responsibilities.notes.get(group.id) ?? '',
        }}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          void reloadGroups();
          void responsibilities.reload();
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={t('delete')}
        message={t('confirmDeleteGroup').replace('{n}', String(activeCount))}
        confirmLabel={t('delete')}
        destructive
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
};

// Who looks after the group and its internal note (managers only; grants
// no rights). Compact: people in a row, the note below.
const ResponsibilityCard = ({
  people,
  note,
  onEdit,
}: {
  people: GroupResponsible[];
  note: string;
  onEdit: () => void;
}) => {
  const { t } = useI18n();
  return (
    <section className="mb-6 rounded-2xl border border-border bg-surface px-4 py-3">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('groupResponsibles')}</h2>
        <button
          type="button"
          onClick={onEdit}
          aria-label={t('edit')}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
        >
          <Pencil size={14} />
        </button>
      </div>
      {people.length === 0 ? (
        <p className="mt-1 text-sm text-text-tertiary">{t('groupNoResponsibles')}</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {people.map((p) => (
            <li key={p.id} className="flex min-w-0 items-center gap-2">
              <Avatar name={p.name || p.email} photoUrl={p.photo_url} size={28} />
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-sm font-medium">{p.name || p.email}</span>
                <span className="flex items-center gap-1 truncate text-xs text-text-tertiary">
                  {p.member?.status === 'active' ? (
                    <>
                      <UserRoundCheck size={11} aria-hidden />
                      {p.member.group_name ?? t('personIsMember')}
                    </>
                  ) : (
                    t('groupResponsiblesNotMember')
                  )}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {note && (
        <p className="mt-3 flex items-start gap-2 whitespace-pre-line border-t border-border pt-2.5 text-sm text-text-secondary">
          <StickyNote size={14} className="mt-0.5 flex-shrink-0 text-text-tertiary" aria-label={t('groupNote')} />
          {note}
        </p>
      )}
    </section>
  );
};
