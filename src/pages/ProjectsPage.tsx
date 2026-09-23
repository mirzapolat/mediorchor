import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FolderKanban, Archive, ArchiveRestore, Pencil, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { Input, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageSpinner } from '@/components/Spinner';
import { Avatar } from '@/components/Avatar';
import { DataTable, type Column, type FilterDef } from '@/components/DataTable';
import { RowActionButton } from '@/components/RowActionButton';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import type { Project } from '@/types';

const empty = { name: '', description: '' };

export const ProjectsPage = () => {
  const { t } = useI18n();
  const { user, canManageProjects } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
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

  const openCreate = () => {
    setEditing(null);
    setForm(empty);
    setFormOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload = { name: form.name.trim(), description: form.description.trim() || null };
    if (editing) {
      await api.from('projects').update(payload).eq('id', editing.id);
    } else {
      await api.from('projects').insert({ ...payload, created_by: user?.id ?? null });
    }
    setSaving(false);
    setFormOpen(false);
    await load();
  };

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
            <Button onClick={openCreate}>
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

      <Modal
        open={formOpen}
        title={editing ? t('editProject') : t('newProject')}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" form="project-form" disabled={saving || !form.name.trim()}>
              {saving ? t('loading') : editing ? t('save') : t('create')}
            </Button>
          </>
        }
      >
        <form id="project-form" onSubmit={save} className="space-y-4">
          <Input
            label={t('projectName')}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            autoFocus
          />
          <Textarea
            label={`${t('description')} (${t('optional')})`}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </form>
      </Modal>

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
