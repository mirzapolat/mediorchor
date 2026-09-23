import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2, Users } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageSpinner } from '@/components/Spinner';
import { Avatar } from '@/components/Avatar';
import { DataTable, type Column, type FilterDef } from '@/components/DataTable';
import { GroupPill } from '@/components/GroupPill';
import { GroupForm } from '@/components/GroupForm';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useProjectContext } from '@/layouts/projectContext';
import { useProjectGroups } from '@/hooks/useProjectGroups';
import type { Member } from '@/types';

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

      <DataTable
        rows={members}
        columns={columns}
        getRowId={(m) => m.id}
        onRowClick={(m) => navigate(`/projects/${project.id}/members/${m.id}`)}
        search={(m) => `${m.first_name} ${m.last_name} ${m.email ?? ''}`}
        filters={filters}
        emptyMessage={t('noMembersInGroup')}
        emptyIcon={Users}
      />

      <GroupForm
        open={formOpen}
        projectId={project.id}
        group={group}
        groups={groups}
        onClose={() => setFormOpen(false)}
        onSaved={() => void reloadGroups()}
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
