import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FolderKanban, Archive, ArchiveRestore, Check, Pencil, Trash2, Users } from 'lucide-react';
import { DeleteProjectDialog } from '@/components/DeleteProjectDialog';
import { PageHeader } from '@/components/PageHeader';
import { PageSpinner } from '@/components/Spinner';
import { Avatar } from '@/components/Avatar';
import { DataTable, type Column } from '@/components/DataTable';
import { RowActionButton } from '@/components/RowActionButton';
import { TableFilterMenu, useTableFilters } from '@/components/TableFilterMenu';
import { HeaderAction } from '@/components/HeaderAction';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import type { Project } from '@/types';

export const ProjectsPage = () => {
  const { t } = useI18n();
  const { canAccessAllProjects, canManageProjects, user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  // Projects I take part in myself: an active member row linked to my account.
  const [participating, setParticipating] = useState<Set<string>>(new Set());
  // Active members per project, only when I may see every project's members
  // (Stimmeltern and up).
  const [activeCounts, setActiveCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [toDelete, setToDelete] = useState<Project | null>(null);
  // Search and filter live in the header menu; the table only applies them.
  const tf = useTableFilters({ status: 'active' });

  const load = async () => {
    const [{ data }, { data: mine }, { data: active }] = await Promise.all([
      api.from('projects').select('*').order('created_at', { ascending: false }),
      user
        ? api.from('members').select('project_id').eq('user_id', user.id).eq('status', 'active')
        : Promise.resolve({ data: [] }),
      canAccessAllProjects
        ? api.from('members').select('project_id').eq('status', 'active')
        : Promise.resolve({ data: [] }),
    ]);
    const list = (data as Project[]) ?? [];
    setProjects(list);
    setParticipating(new Set(((mine as { project_id: string }[] | null) ?? []).map((m) => m.project_id)));
    // Teilnehmer only get their own member rows, so they see no counts.
    const counts = new Map<string, number>();
    if (canAccessAllProjects) for (const p of list) counts.set(p.id, 0);
    for (const m of (active as { project_id: string }[] | null) ?? []) {
      if (counts.has(m.project_id)) counts.set(m.project_id, counts.get(m.project_id)! + 1);
    }
    setActiveCounts(counts);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, canAccessAllProjects]);

  const toggleArchive = async (p: Project) => {
    await api
      .from('projects')
      .update({ status: p.status === 'archived' ? 'active' : 'archived' })
      .eq('id', p.id);
    await load();
  };

  if (loading) return <PageSpinner />;

  const columns: Column<Project>[] = [
    {
      id: 'name',
      header: t('projectLabel'),
      accessor: (p) => p.name,
      // Name and description in one column: the description is the name's
      // secondary line (one line, clipped).
      render: (p) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={p.name} photoUrl={p.image_url} size={p.description ? 36 : 28} square />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium">{p.name}</span>
              {p.status === 'archived' && (
                <span className="text-xs text-text-tertiary border border-border rounded-md px-1.5 py-0.5">
                  {t('archived')}
                </span>
              )}
            </div>
            {p.description ? (
              <p className="line-clamp-1 text-sm text-text-secondary">{p.description}</p>
            ) : null}
          </div>
        </div>
      ),
    },
    ...(activeCounts.size > 0
      ? [
          {
            id: 'activeMembers',
            header: t('activeMembers'),
            accessor: (p: Project) => activeCounts.get(p.id) ?? null,
            className: 'w-px whitespace-nowrap text-center',
            render: (p: Project) =>
              activeCounts.has(p.id) ? (
                <span className="inline-flex items-center gap-1.5 tabular-nums text-text-secondary">
                  <Users size={14} />
                  {activeCounts.get(p.id)}
                </span>
              ) : (
                <span className="text-text-tertiary">—</span>
              ),
          } satisfies Column<Project>,
        ]
      : []),
    {
      id: 'participating',
      header: t('myParticipation'),
      accessor: (p) => (participating.has(p.id) ? 1 : 0),
      className: 'w-px whitespace-nowrap',
      render: (p) =>
        participating.has(p.id) ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success-strong">
            <Check size={15} />
            {t('participatingYes')}
          </span>
        ) : (
          <span className="text-text-tertiary">—</span>
        ),
    },
  ];

  const filters = tf.bind<Project>([
    {
      id: 'status',
      label: t('status'),
      options: [
        { value: 'active', label: t('active') },
        { value: 'archived', label: t('archived') },
      ],
      predicate: (p, v) => p.status === v,
    },
    {
      id: 'participating',
      label: t('myParticipation'),
      options: [
        { value: 'yes', label: t('participatingYes') },
        { value: 'no', label: t('participatingNo') },
      ],
      predicate: (p, v) => participating.has(p.id) === (v === 'yes'),
    },
  ]);

  return (
    <>
      <PageHeader
        title={t('projects')}
        inlineActions
        actions={
          <>
            <TableFilterMenu query={tf.query} onQueryChange={tf.setQuery} filters={filters} />
            {canManageProjects && (
              <HeaderAction icon={Plus} label={t('newProject')} onClick={() => navigate('/projects/new')} />
            )}
          </>
        }
      />

      <DataTable
        rows={projects}
        columns={columns}
        getRowId={(p) => p.id}
        onRowClick={(p) => navigate(`/projects/${p.id}`)}
        search={(p) => `${p.name} ${p.description ?? ''}`}
        filters={filters}
        query={tf.query}
        hideToolbar
        emptyMessage={t('noProjects')}
        emptyIcon={FolderKanban}
        // Settings, archiving and deletion need Verwaltung; Stimmeltern only
        // work with a project's content.
        actions={
          canManageProjects
            ? (p) => (
                <>
                  <RowActionButton
                    label={t('edit')}
                    onClick={() => navigate(`/projects/${p.id}/settings`)}
                  >
                    <Pencil size={15} />
                  </RowActionButton>
                  <RowActionButton label={t('archive')} onClick={() => toggleArchive(p)}>
                    {p.status === 'archived' ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                  </RowActionButton>
                  <RowActionButton label={t('delete')} onClick={() => setToDelete(p)}>
                    <Trash2 size={15} />
                  </RowActionButton>
                </>
              )
            : undefined
        }
      />

      <DeleteProjectDialog
        project={toDelete}
        onClose={() => setToDelete(null)}
        onArchived={() => {
          setToDelete(null);
          void load();
        }}
        onDeleted={() => {
          setToDelete(null);
          void load();
        }}
      />
    </>
  );
};
