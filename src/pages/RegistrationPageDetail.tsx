import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  ClipboardList,
  Pencil,
  Play,
  Settings,
  Shuffle,
  Square,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageSpinner } from '@/components/Spinner';
import { DataTable, type Column, type FilterDef } from '@/components/DataTable';
import { RowActionButton } from '@/components/RowActionButton';
import { RegistrationSelectionDialog } from '@/components/RegistrationSelectionDialog';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useProjectContext } from '@/layouts/projectContext';
import type { Registration, RegistrationPage } from '@/types';
import { useProjectGroups } from '@/hooks/useProjectGroups';
import { GroupPill } from '@/components/GroupPill';

interface Draft {
  first_name: string;
  last_name: string;
  email: string;
  group_name: string;
}

export const RegistrationPageDetail = () => {
  const { t, lang } = useI18n();
  const { project } = useProjectContext();
  const { find: findGroup } = useProjectGroups();
  const { pageId } = useParams();
  const navigate = useNavigate();

  const [page, setPage] = useState<RegistrationPage | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ first_name: '', last_name: '', email: '', group_name: '' });
  const [toDelete, setToDelete] = useState<Registration | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [selectionOpen, setSelectionOpen] = useState(false);

  const load = useCallback(async () => {
    const [pageResult, regsResult] = await Promise.all([
      api.from('registration_pages').select('*').eq('id', pageId).maybeSingle(),
      api
        .from('registrations')
        .select('*')
        .eq('registration_page_id', pageId)
        .order('created_at', { ascending: false }),
    ]);
    setPage((pageResult.data as RegistrationPage | null) ?? null);
    setRegistrations((regsResult.data as Registration[] | null) ?? []);
    setLoading(false);
  }, [pageId]);

  useEffect(() => {
    void load();
  }, [load]);

  const dateFormatter = new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  if (loading) return <PageSpinner />;
  if (!page) {
    navigate(`/projects/${project.id}/registrations`);
    return null;
  }

  const pendingCount = registrations.filter((r) => !r.transferred).length;

  const toggleActive = async () => {
    setBusy(true);
    const { data } = await api
      .from('registration_pages')
      .update({ is_active: !page.is_active })
      .eq('id', page.id)
      .select()
      .single();
    if (data) setPage(data as RegistrationPage);
    setBusy(false);
  };

  const transferOne = async (registration: Registration) => {
    setBusy(true);
    await api.rpc('transfer_registration', { p_registration_id: registration.id });
    await load();
    setBusy(false);
  };

  const transferAll = async () => {
    setBusy(true);
    await api.rpc('transfer_all_registrations', { p_page_id: page.id });
    await load();
    setBusy(false);
  };

  const bulkTransfer = async () => {
    setBusy(true);
    await Promise.all(
      selectedIds.map((id) => api.rpc('transfer_registration', { p_registration_id: id })),
    );
    setSelectedIds([]);
    await load();
    setBusy(false);
  };

  const bulkDelete = async () => {
    setBusy(true);
    await api.from('registrations').delete().in('id', selectedIds);
    setSelectedIds([]);
    setBulkDeleteOpen(false);
    await load();
    setBusy(false);
  };

  const startEdit = (registration: Registration) => {
    setEditingId(registration.id);
    setDraft({
      first_name: registration.first_name,
      last_name: registration.last_name,
      email: registration.email ?? '',
      group_name: registration.group_name ?? '',
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setBusy(true);
    await api
      .from('registrations')
      .update({
        first_name: draft.first_name.trim(),
        last_name: draft.last_name.trim(),
        email: draft.email.trim() || null,
        group_name: draft.group_name.trim() || null,
        // Hand edits win: the row is no longer re-mapped from its raw fields.
        raw_payload: null,
      })
      .eq('id', editingId);
    setEditingId(null);
    await load();
    setBusy(false);
  };

  const remove = async () => {
    if (!toDelete) return;
    await api.from('registrations').delete().eq('id', toDelete.id);
    setToDelete(null);
    await load();
  };

  const editableCell = (
    registration: Registration,
    field: keyof Draft,
    value: string | null,
  ) =>
    editingId === registration.id ? (
      <Input
        value={draft[field]}
        onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
        className="py-1.5 text-sm"
      />
    ) : (
      <span className="text-text-secondary">{value || '—'}</span>
    );

  const columns: Column<Registration>[] = [
    {
      id: 'first_name',
      header: t('firstName'),
      accessor: (r) => r.first_name,
      render: (r) => editableCell(r, 'first_name', r.first_name),
    },
    {
      id: 'last_name',
      header: t('lastName'),
      accessor: (r) => r.last_name,
      render: (r) => editableCell(r, 'last_name', r.last_name),
    },
    ...(page.ask_email
      ? [
          {
            id: 'email',
            header: t('email'),
            accessor: (r: Registration) => r.email,
            render: (r: Registration) => editableCell(r, 'email', r.email),
          },
        ]
      : []),
    ...(page.ask_group
      ? [
          {
            id: 'group',
            header: t('group'),
            accessor: (r: Registration) => r.group_name,
            render: (r: Registration) =>
              editingId !== r.id &&
              !r.transferred &&
              r.group_name &&
              !findGroup(r.group_name) ? (
                <span>
                  <GroupPill name={r.group_name} />
                  <span className="block text-xs text-accent">{t('unknownGroupHint')}</span>
                </span>
              ) : editingId === r.id ? (
                editableCell(r, 'group_name', r.group_name)
              ) : (
                <GroupPill name={r.group_name} />
              ),
          },
        ]
      : []),
    {
      id: 'status',
      header: t('status'),
      accessor: (r) => (r.transferred ? 1 : 0),
      render: (r) =>
        r.transferred ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-[#f0fdf4] px-2 py-0.5 text-xs font-semibold text-[#16803b]">
            <Check size={12} />
            {t('transferred')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md bg-[#f5f5f5] px-2 py-0.5 text-xs font-semibold text-text-secondary">
            {t('notTransferred')}
          </span>
        ),
      className: 'w-px whitespace-nowrap',
    },
    {
      id: 'registered',
      header: t('registeredAt'),
      accessor: (r) => r.created_at,
      render: (r) => (
        <span className="whitespace-nowrap text-text-secondary">
          {dateFormatter.format(new Date(r.created_at))}
        </span>
      ),
      className: 'w-px',
    },
  ];

  const filters: FilterDef<Registration>[] = [
    {
      id: 'transferred',
      label: t('status'),
      options: [
        { value: 'pending', label: t('notTransferred') },
        { value: 'done', label: t('transferred') },
      ],
      predicate: (r, v) => (v === 'done' ? r.transferred : !r.transferred),
    },
  ];

  return (
    <>
      <button
        onClick={() => navigate(`/projects/${project.id}/registrations`)}
        className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text"
      >
        <ArrowLeft size={16} />
        {t('registrationPages')}
      </button>

      <PageHeader
        title={page.title}
        subtitle={`${registrations.length} ${t('registrations').toLowerCase()} · ${
          page.is_active ? t('active') : t('registrationInactiveStatus')
        }`}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => navigate(`/projects/${project.id}/registrations/${page.id}/settings`)}
            >
              <Settings size={16} />
              {t('settings')}
            </Button>
            <Button
              variant={page.is_active ? 'accent' : 'primary'}
              disabled={busy}
              onClick={toggleActive}
            >
              {page.is_active ? <Square size={15} /> : <Play size={16} />}
              {page.is_active ? t('deactivate') : t('activate')}
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('registrations')}</h2>
        {selectedIds.length > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-secondary">
              {t('selectedCount').replace('{n}', String(selectedIds.length))}
            </span>
            <Button variant="secondary" disabled={busy} onClick={bulkTransfer}>
              <UserPlus size={16} />
              {t('transferToMembers')}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setBulkDeleteOpen(true)}>
              <Trash2 size={16} />
              {t('delete')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              disabled={busy || pendingCount === 0}
              onClick={() => setSelectionOpen(true)}
            >
              <Shuffle size={16} />
              {t('transferSelection')}
            </Button>
            <Button disabled={busy || pendingCount === 0} onClick={transferAll}>
              <Users size={16} />
              {t('transferAllToMembers')}
              {pendingCount > 0 ? ` (${pendingCount})` : ''}
            </Button>
          </div>
        )}
      </div>

      <DataTable
        rows={registrations}
        columns={columns}
        getRowId={(r) => r.id}
        search={(r) => `${r.first_name} ${r.last_name} ${r.email ?? ''} ${r.group_name ?? ''}`}
        filters={filters}
        selectedIds={selectedIds}
        onSelectedIdsChange={setSelectedIds}
        emptyMessage={t('noRegistrations')}
        emptyIcon={ClipboardList}
        actions={(r) =>
          editingId === r.id ? (
            <>
              <RowActionButton label={t('save')} onClick={saveEdit}>
                <Check size={15} />
              </RowActionButton>
              <RowActionButton label={t('cancel')} onClick={() => setEditingId(null)}>
                <X size={15} />
              </RowActionButton>
            </>
          ) : (
            <>
              {!r.transferred ? (
                <RowActionButton label={t('transferToMembers')} onClick={() => transferOne(r)}>
                  <UserPlus size={15} />
                </RowActionButton>
              ) : null}
              <RowActionButton label={t('edit')} onClick={() => startEdit(r)}>
                <Pencil size={15} />
              </RowActionButton>
              <RowActionButton label={t('delete')} onClick={() => setToDelete(r)}>
                <Trash2 size={15} />
              </RowActionButton>
            </>
          )
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

      <RegistrationSelectionDialog
        open={selectionOpen}
        pageId={page.id}
        pending={registrations.filter((r) => !r.transferred)}
        onClose={() => setSelectionOpen(false)}
        onTransferred={() => void load()}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        title={t('delete')}
        message={t('confirmBulkDeleteRegistrations')}
        confirmLabel={t('delete')}
        destructive
        onConfirm={bulkDelete}
        onCancel={() => setBulkDeleteOpen(false)}
      />
    </>
  );
};
