import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FolderKanban, Archive, ArchiveRestore, Pencil, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageSpinner } from '@/components/Spinner';
import { Avatar } from '@/components/Avatar';
import { DataTable, type Column, type FilterDef } from '@/components/DataTable';
import { RowActionButton } from '@/components/RowActionButton';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import type { Project } from '@/types';

export const ProjectsPage = () => {
  const { t } = useI18n();
  const { canManageProjects } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [toDelete, setToDelete] = useState<Project | null>(null);

  const load = async () => {
    const { data } = await api
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false });
    setProjects((data as Project[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const toggleArchive = async (p: Project) => {
    await api
      .from('projects')
      .update({ status: p.status === 'archived' ? 'active' : 'archived' })
      .eq('id', p.id);
    await load();
  };

  const remove = async () => {
    if (!toDelete) return;
    await api.from('projects').delete().eq('id', toDelete.id);
    setToDelete(null);
    await load();
  };

  if (loading) return <PageSpinner />;

  const columns: Column<Project>[] = [
    {
      id: 'name',
      header: t('projectName'),
      accessor: (p) => p.name,
      render: (p) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={p.name} photoUrl={p.image_url} size={28} square />
          <span className="font-medium">{p.name}</span>
          {p.status === 'archived' && (
            <span className="text-xs text-text-tertiary border border-border rounded-md px-1.5 py-0.5">
              {t('archived')}
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'description',
      header: t('description'),
      accessor: (p) => p.description,
      render: (p) =>
        p.description ? (
          <span className="text-text-secondary line-clamp-1">{p.description}</span>
        ) : (
          <span className="text-text-secondary">—</span>
        ),
    },
  ];

  const filters: FilterDef<Project>[] = [
    {
      id: 'status',
      label: t('status'),
      defaultValue: 'active',
      options: [
        { value: 'active', label: t('active') },
        { value: 'archived', label: t('archived') },
      ],
      predicate: (p, v) => p.status === v,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('projects')}
        actions={
          canManageProjects ? (
            <Button onClick={() => navigate('/projects/new')}>
              <Plus size={16} />
              {t('newProject')}
            </Button>
          ) : undefined
        }
      />

      <DataTable
        rows={projects}
        columns={columns}
        getRowId={(p) => p.id}
        onRowClick={(p) => navigate(`/projects/${p.id}`)}
        search={(p) => `${p.name} ${p.description ?? ''}`}
        filters={filters}
        emptyMessage={t('noProjects')}
        emptyIcon={FolderKanban}
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
