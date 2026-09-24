import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Users, Archive, ArchiveRestore, Pencil, Trash2, Upload } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageSpinner } from '@/components/Spinner';
import { Avatar } from '@/components/Avatar';
import { MemberForm } from '@/components/MemberForm';
import { MemberImport } from '@/components/MemberImport';
import { DataTable, type Column } from '@/components/DataTable';
import { TableFilterMenu, useTableFilters } from '@/components/TableFilterMenu';
import { HeaderAction } from '@/components/HeaderAction';
import { RowActionButton } from '@/components/RowActionButton';
import { useI18n } from '@/lib/i18n';
import { accountNameDeviation } from '@/lib/accountName';
import { api } from '@/lib/api';
import { useProjectContext } from '@/layouts/projectContext';
import type { Member } from '@/types';
import { useProjectGroups } from '@/hooks/useProjectGroups';
import { GroupPill } from '@/components/GroupPill';

export const MembersPage = () => {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const { names: groups, reload: reloadGroups } = useProjectGroups();
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  // Account display names behind linked members, to flag deviating names.
  const [accountNames, setAccountNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const tf = useTableFilters({ status: 'active' });

  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [toDelete, setToDelete] = useState<Member | null>(null);

  const load = useCallback(async () => {
    const [membersResult, namesResult] = await Promise.all([
      api
        .from('members')
        .select('*')
        .eq('project_id', project.id)
        .in('status', ['active', 'archived'])
        .order('last_name'),
      api.rpc('linked_account_names', { p_project_id: project.id }),
    ]);
    setMembers((membersResult.data as Member[] | null) ?? []);
    setAccountNames(
      Object.fromEntries(
        ((namesResult.data as { member_id: string; account_name: string }[] | null) ?? []).map(
          (row) => [row.member_id, row.account_name],
        ),
      ),
    );
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleArchive = async (m: Member) => {
    await api
      .from('members')
      .update({ status: m.status === 'archived' ? 'active' : 'archived' })
      .eq('id', m.id);
    await load();
  };

  const remove = async () => {
    if (!toDelete) return;
    await api.from('members').delete().eq('id', toDelete.id);
    setToDelete(null);
    await load();
  };

  if (loading) return <PageSpinner />;

  const columns: Column<Member>[] = [
    {
      id: 'first_name',
      header: t('firstName'),
      accessor: (m) => m.first_name,
      render: (m) => {
        // A name that differs from the linked account's shows as a dot on the
        // photo; the details are in the tooltip (and on the member's page).
        const deviation = accountNameDeviation(m, accountNames[m.id]);
        const hint = deviation ? `${t('nameDiffersFromAccount')}: ${deviation}` : undefined;
        return (
          <div className="flex items-center gap-2.5">
            <span className="relative flex-shrink-0" title={hint}>
              <Avatar name={`${m.first_name} ${m.last_name}`} photoUrl={m.photo_url} size={28} />
              {hint ? (
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-surface">
                  <span className="sr-only">{hint}</span>
                </span>
              ) : null}
            </span>
            <span>{m.first_name}</span>
          </div>
        );
      },
    },
    {
      id: 'last_name',
      header: t('lastName'),
      accessor: (m) => m.last_name,
      render: (m) => {
        return (
          <div className="flex items-center gap-2.5">
            <span>{m.last_name || '—'}</span>
            {m.status === 'archived' && (
              <span className="text-xs text-text-tertiary border border-border rounded-md px-1.5 py-0.5">
                {t('archived')}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: 'group',
      header: t('group'),
      accessor: (m) => m.group_name,
      render: (m) => <GroupPill name={m.group_name} />,
    },
    {
      id: 'email',
      header: t('email'),
      accessor: (m) => m.email,
      render: (m) => <span className="text-text-secondary">{m.email ?? '—'}</span>,
    },
  ];

  const filters = tf.bind<Member>([
    {
      id: 'status',
      label: t('status'),
      options: [
        { value: 'active', label: t('active') },
        { value: 'archived', label: t('archived') },
      ],
      predicate: (m, v) => m.status === v,
    },
    {
      id: 'group',
      label: t('group'),
      options: groups.map((g) => ({ value: g, label: g })),
      predicate: (m, v) => m.group_name === v,
    },
  ]);

  return (
    <>
      <PageHeader
        title={t('members')}
        inlineActions
        actions={
          <>
            <TableFilterMenu query={tf.query} onQueryChange={tf.setQuery} filters={filters} />
            <HeaderAction
              icon={Upload}
              label={t('importCsv')}
              variant="secondary"
              onClick={() => setImportOpen(true)}
            />
            <HeaderAction
              icon={Plus}
              label={t('newMember')}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            />
          </>
        }
      />

      <DataTable
        rows={members}
        columns={columns}
        getRowId={(m) => m.id}
        onRowClick={(m) => navigate(`/projects/${project.id}/members/${m.id}`)}
        search={(m) => `${m.first_name} ${m.last_name} ${m.group_name ?? ''} ${m.email ?? ''}`}
        filters={filters}
        query={tf.query}
        hideToolbar
        emptyMessage={t('noMembers')}
        emptyIcon={Users}
        actions={(m) => (
          <>
            <RowActionButton
              label={t('edit')}
              onClick={() => navigate(`/projects/${project.id}/members/${m.id}`)}
            >
              <Pencil size={15} />
            </RowActionButton>
            <RowActionButton label={t('archive')} onClick={() => toggleArchive(m)}>
              {m.status === 'archived' ? <ArchiveRestore size={15} /> : <Archive size={15} />}
            </RowActionButton>
            <RowActionButton label={t('delete')} onClick={() => setToDelete(m)}>
              <Trash2 size={15} />
            </RowActionButton>
          </>
        )}
      />

      <MemberForm
        open={formOpen}
        projectId={project.id}
        member={editing}
        groups={groups}
        onClose={() => setFormOpen(false)}
        onSaved={load}
      />

      <MemberImport
        open={importOpen}
        projectId={project.id}
        groups={groups}
        onClose={() => setImportOpen(false)}
        onSaved={() => {
          void reloadGroups();
          void load();
        }}
      />

      <ConfirmDialog
        open={!!toDelete}
        title={t('delete')}
        message={t('confirmDelete')}
        confirmLabel={t('delete')}
        destructive
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </>
  );
};
