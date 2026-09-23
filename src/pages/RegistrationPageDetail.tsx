import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  ClipboardList,
  Copy,
  Pencil,
  Play,
  Square,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Input } from '@/components/Input';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageSpinner } from '@/components/Spinner';
import { DataTable, type Column, type FilterDef } from '@/components/DataTable';
import { RowActionButton } from '@/components/RowActionButton';
import { RegistrationPageForm } from '@/components/RegistrationPageForm';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useProjectContext } from '@/layouts/projectContext';
import type { Registration, RegistrationPage } from '@/types';

interface Draft {
  first_name: string;
  last_name: string;
  email: string;
  group_name: string;
}

export const RegistrationPageDetail = () => {
  const { t, lang } = useI18n();
  const { project } = useProjectContext();
  const { pageId } = useParams();
  const navigate = useNavigate();

  const [page, setPage] = useState<RegistrationPage | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ first_name: '', last_name: '', email: '', group_name: '' });
  const [toDelete, setToDelete] = useState<Registration | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

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

  const publicUrl = `${window.location.origin}/register/${page.token}`;
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

  const toggleAutoTransfer = async () => {
    setBusy(true);
    const { data } = await api
      .from('registration_pages')
      .update({ auto_transfer: !page.auto_transfer })
      .eq('id', page.id)
      .select()
      .single();
    if (data) setPage(data as RegistrationPage);
    setBusy(false);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard unavailable */
    }
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
            render: (r: Registration) => editableCell(r, 'group_name', r.group_name),
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
        subtitle={`${registrations.length} ${t('registrations').toLowerCase()}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(true)}>
              <Pencil size={16} />
              {t('edit')}
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

      <Card className="mb-6 p-5 space-y-4">
        <div>
          <div
            className={`inline-flex items-center gap-2 text-sm font-medium ${
              page.is_active ? 'text-[#16803b]' : 'text-text-secondary'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${page.is_active ? 'bg-[#16a34a]' : 'bg-text-tertiary'}`}
            />
            {page.is_active ? t('registrationActive') : t('registrationInactiveStatus')}
          </div>
          <p className="mt-2 text-sm text-text-secondary">{t('registrationLinkHint')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="max-w-full truncate text-sm text-text-tertiary underline underline-offset-2 hover:text-text"
            >
              {publicUrl}
            </a>
            <Button variant="secondary" onClick={copyLink}>
              <Copy size={15} />
              {copied ? t('linkCopied') : t('copyCheckInLink')}
            </Button>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3 border-t border-border pt-4">
          <input
            type="checkbox"
            checked={page.auto_transfer}
            disabled={busy}
            onChange={toggleAutoTransfer}
            className="mt-0.5 accent-black"
          />
          <span>
            <span className="block text-sm font-medium">{t('autoTransfer')}</span>
            <span className="mt-0.5 block text-sm text-text-secondary">{t('autoTransferHint')}</span>
          </span>
        </label>
      </Card>

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
          <Button disabled={busy || pendingCount === 0} onClick={transferAll}>
            <Users size={16} />
            {t('transferAllToMembers')}
            {pendingCount > 0 ? ` (${pendingCount})` : ''}
          </Button>
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

      <RegistrationPageForm
        open={formOpen}
        projectId={project.id}
        page={page}
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
