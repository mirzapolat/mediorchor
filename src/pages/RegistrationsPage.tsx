import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, FileText, Pencil, Plus, Trash2, Webhook } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageSpinner } from '@/components/Spinner';
import { DataTable, type Column } from '@/components/DataTable';
import { TableFilterMenu, useTableFilters } from '@/components/TableFilterMenu';
import { HeaderAction } from '@/components/HeaderAction';
import { RowActionButton } from '@/components/RowActionButton';
import { RegistrationPageForm } from '@/components/RegistrationPageForm';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useProjectContext } from '@/layouts/projectContext';
import { registrationState } from '@/lib/registrationDeadline';
import { isDuplicateRegistration } from '@/lib/memberMatching';
import type { Member, Registration, RegistrationPage } from '@/types';

export const RegistrationsPage = () => {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const navigate = useNavigate();
  const [pages, setPages] = useState<RegistrationPage[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Registrations not yet transferred into the member list, duplicates of
  // active members left out.
  const [openCounts, setOpenCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const tf = useTableFilters();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RegistrationPage | null>(null);
  const [toDelete, setToDelete] = useState<RegistrationPage | null>(null);

  const load = useCallback(async () => {
    const [pagesResult, regsResult, membersResult] = await Promise.all([
      api
        .from('registration_pages')
        .select('*')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false }),
      api
        .from('registrations')
        .select(
          'registration_page_id, first_name, last_name, email, user_id, transferred, registration_pages!inner(project_id)',
        )
        .eq('registration_pages.project_id', project.id),
      api.from('members').select('first_name, last_name, email, user_id, status').eq('project_id', project.id),
    ]);

    const members = (membersResult.data as Member[] | null) ?? [];
    const grouped: Record<string, number> = {};
    const open: Record<string, number> = {};
    for (const row of (regsResult.data as Registration[] | null) ?? []) {
      grouped[row.registration_page_id] = (grouped[row.registration_page_id] ?? 0) + 1;
      if (!row.transferred && !isDuplicateRegistration(row, members)) open[row.registration_page_id] = (open[row.registration_page_id] ?? 0) + 1;
    }
    setOpenCounts(open);
    setPages((pagesResult.data as RegistrationPage[] | null) ?? []);
    setCounts(grouped);
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async () => {
    if (!toDelete) return;
    await api.from('registration_pages').delete().eq('id', toDelete.id);
    setToDelete(null);
    await load();
  };

  if (loading) return <PageSpinner />;

  const columns: Column<RegistrationPage>[] = [
    {
      id: 'title',
      header: t('registrationTitle'),
      accessor: (p) => p.title,
      render: (p) => <span className="font-medium">{p.title}</span>,
    },
    {
      id: 'source',
      header: t('registrationSource'),
      accessor: (p) => p.source,
      render: (p) => (
        <span className="inline-flex items-center gap-1.5 text-sm text-text-secondary">
          {p.source === 'webhook' ? <Webhook size={14} /> : <FileText size={14} />}
          {p.source === 'webhook' ? t('sourceWebhook') : t('sourceForm')}
        </span>
      ),
      className: 'w-px whitespace-nowrap',
    },
    {
      id: 'status',
      header: t('status'),
      accessor: (p) => ({ active: 2, closed: 1, inactive: 0 })[registrationState(p)],
      render: (p) =>
        registrationState(p) === 'active' ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success-strong">
            <span className="h-2 w-2 rounded-full bg-success" />
            {t('active')}
          </span>
        ) : registrationState(p) === 'closed' ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary">
            <span className="h-2 w-2 rounded-full bg-accent" />
            {t('registrationClosedStatus')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary">
            <span className="h-2 w-2 rounded-full bg-text-tertiary" />
            {t('registrationInactiveStatus')}
          </span>
        ),
    },
    {
      id: 'registrations',
      header: t('registrations'),
      accessor: (p) => counts[p.id] ?? 0,
      render: (p) => <span className="text-text-secondary">{counts[p.id] ?? 0}</span>,
      className: 'w-px text-center whitespace-nowrap',
    },
    {
      id: 'open',
      header: t('openRegistrations'),
      accessor: (p) => openCounts[p.id] ?? 0,
      render: (p) =>
        openCounts[p.id] ? (
          <span className="inline-flex min-w-[1.75rem] justify-center rounded-md bg-info-soft px-2 py-0.5 text-sm font-semibold tabular-nums text-text">
            {openCounts[p.id]}
          </span>
        ) : (
          <span className="text-text-tertiary">0</span>
        ),
      className: 'w-px text-center whitespace-nowrap',
    },
  ];

  const filters = tf.bind<RegistrationPage>([
    {
      id: 'source',
      label: t('registrationSource'),
      options: [
        { value: 'form', label: t('sourceForm') },
        { value: 'webhook', label: t('sourceWebhook') },
      ],
      predicate: (p, v) => p.source === v,
    },
    {
      id: 'status',
      label: t('status'),
      options: [
        { value: 'active', label: t('active') },
        { value: 'closed', label: t('registrationClosedStatus') },
        { value: 'inactive', label: t('registrationInactiveStatus') },
      ],
      predicate: (p, v) => registrationState(p) === v,
    },
  ]);

  return (
    <>
      <PageHeader
        title={t('registrationPages')}
        inlineActions
        actions={
          <>
            <TableFilterMenu query={tf.query} onQueryChange={tf.setQuery} filters={filters} />
            <HeaderAction
              icon={Plus}
              label={t('newRegistrationPage')}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            />
          </>
        }
      />

      <DataTable
        rows={pages}
        columns={columns}
        getRowId={(p) => p.id}
        onRowClick={(p) => navigate(`/projects/${project.id}/registrations/${p.id}`)}
        search={(p) => p.title}
        filters={filters}
        query={tf.query}
        hideToolbar
        emptyMessage={t('noRegistrationPages')}
        emptyIcon={ClipboardList}
        actions={(p) => (
          <>
            <RowActionButton
              label={t('edit')}
              onClick={() => {
                setEditing(p);
                setFormOpen(true);
              }}
            >
              <Pencil size={15} />
            </RowActionButton>
            <RowActionButton label={t('delete')} onClick={() => setToDelete(p)}>
              <Trash2 size={15} />
            </RowActionButton>
          </>
        )}
      />

      <RegistrationPageForm
        open={formOpen}
        projectId={project.id}
        page={editing}
        onClose={() => setFormOpen(false)}
        onSaved={load}
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
