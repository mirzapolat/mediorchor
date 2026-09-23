import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageSpinner } from '@/components/Spinner';
import { DataTable, type Column } from '@/components/DataTable';
import { RowActionButton } from '@/components/RowActionButton';
import { GroupPill } from '@/components/GroupPill';
import { GroupForm } from '@/components/GroupForm';
import { GroupDonut, type DonutSlice } from '@/components/GroupDonut';
import { Card } from '@/components/Card';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useProjectContext } from '@/layouts/projectContext';
import { useProjectGroups } from '@/hooks/useProjectGroups';
import type { ProjectGroup } from '@/types';

// Counts active members per group (by lower-cased group name; '' = no group).
const countMembersByGroup = (rows: { group_name: string | null }[]) => {
  const counts = new Map<string, number>();
  for (const { group_name } of rows) {
    const key = (group_name ?? '').trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

export const GroupsPage = () => {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const { groups: sharedGroups, reload: reloadShared } = useProjectGroups();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectGroup | null>(null);
  const [toDelete, setToDelete] = useState<ProjectGroup | null>(null);

  const loadCounts = useCallback(async () => {
    const { data } = await api
      .from('members')
      .select('group_name')
      .eq('project_id', project.id)
      .eq('status', 'active');
    setCounts(countMembersByGroup((data as { group_name: string | null }[] | null) ?? []));
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  // The shared list (from the layout) is the source; keep a local copy so
  // drag & drop can reorder optimistically.
  useEffect(() => setGroups(sharedGroups), [sharedGroups]);

  const reload = async () => {
    await Promise.all([reloadShared(), loadCounts()]);
  };

  const reorder = async (next: ProjectGroup[]) => {
    setGroups(next);
    await Promise.all(
      next.map((g, index) =>
        g.position === index ? null : api.from('project_groups').update({ position: index }).eq('id', g.id),
      ),
    );
    await reloadShared();
  };

  const remove = async () => {
    if (!toDelete) return;
    await api.from('project_groups').delete().eq('id', toDelete.id);
    setToDelete(null);
    await reload();
  };

  if (loading) return <PageSpinner />;

  const countOf = (g: ProjectGroup) => counts.get(g.name.toLowerCase()) ?? 0;
  const unassigned = counts.get('') ?? 0;

  const slices: DonutSlice[] = [
    ...groups.map((g) => ({ id: g.id, label: g.name, value: countOf(g), color: g.color })),
    ...(unassigned > 0
      ? [{ id: 'none', label: t('noGroupAssigned'), value: unassigned, color: '', muted: true }]
      : []),
  ];

  const columns: Column<ProjectGroup>[] = [
    {
      id: 'name',
      header: t('name'),
      render: (g) => <GroupPill name={g.name} color={g.color} className="text-sm" />,
    },
    {
      id: 'members',
      header: t('groupMemberCount'),
      render: (g) => <span className="text-text-secondary">{countOf(g)}</span>,
      className: 'w-px whitespace-nowrap text-center',
    },
  ];

  return (
    <>
      <PageHeader
        title={t('groupsList')}
        subtitle={t('groupsHint')}
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus size={16} />
            {t('newGroup')}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <DataTable
          rows={groups}
          columns={columns}
          getRowId={(g) => g.id}
          onRowClick={(g) => navigate(`/projects/${project.id}/groups/${g.id}`)}
          onReorder={reorder}
          emptyMessage={t('noGroups')}
          emptyIcon={Tags}
          actions={(g) => (
            <>
              <RowActionButton
                label={t('edit')}
                onClick={() => {
                  setEditing(g);
                  setFormOpen(true);
                }}
              >
                <Pencil size={15} />
              </RowActionButton>
              <RowActionButton label={t('delete')} onClick={() => setToDelete(g)}>
                <Trash2 size={15} />
              </RowActionButton>
            </>
          )}
        />

        {groups.length > 0 && (
          <Card className="p-6 lg:sticky lg:top-6">
            <div className="mb-5">
              <h2 className="text-base font-medium">{t('groupDistribution')}</h2>
              <p className="mt-0.5 text-sm text-text-secondary">{t('groupDistributionHint')}</p>
            </div>
            <GroupDonut
              slices={slices}
              onSelect={(slice) => navigate(`/projects/${project.id}/groups/${slice.id}`)}
            />
          </Card>
        )}
      </div>

      <GroupForm
        open={formOpen}
        projectId={project.id}
        group={editing}
        groups={groups}
        onClose={() => setFormOpen(false)}
        onSaved={() => void reload()}
      />

      <ConfirmDialog
        open={!!toDelete}
        title={t('delete')}
        message={t('confirmDeleteGroup').replace('{n}', String(toDelete ? countOf(toDelete) : 0))}
        confirmLabel={t('delete')}
        destructive
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </>
  );
};
