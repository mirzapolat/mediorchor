import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronDown,
  ClipboardList,
  FileText,
  Pencil,
  Play,
  Settings,
  Shuffle,
  Square,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  Webhook,
  X,
  Zap,
} from 'lucide-react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageSpinner } from '@/components/Spinner';
import { DataTable, type Column } from '@/components/DataTable';
import { TableFilterMenu, useTableFilters } from '@/components/TableFilterMenu';
import { HeaderAction } from '@/components/HeaderAction';
import { RowActionButton } from '@/components/RowActionButton';
import { RegistrationSelectionDialog } from '@/components/RegistrationSelectionDialog';
import { useI18n } from '@/lib/i18n';
import { FALLBACK_GROUP_COLOR, isHexColor, paletteColor } from '@/lib/groupColors';
import { GroupDonut, type DonutSlice } from '@/components/GroupDonut';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import { useProjectContext } from '@/layouts/projectContext';
import type { Member, Registration, RegistrationPage } from '@/types';
import { findMatchingMember } from '@/lib/memberMatching';
import { useProjectGroups } from '@/hooks/useProjectGroups';
import { formatDeadline, registrationState } from '@/lib/registrationDeadline';
import { GroupPill } from '@/components/GroupPill';

const DISTRIBUTION_OPEN_KEY = 'registrations.distributionOpen';

// Thin proportional bar of the groups, the collapsed distribution's summary.
const DistributionBar = ({ slices }: { slices: DonutSlice[] }) => {
  const visible = slices.filter((s) => s.value > 0);
  return (
    <span className="flex h-2 min-w-0 max-w-sm flex-1 gap-0.5 overflow-hidden rounded-full" aria-hidden>
      {visible.map((s) => (
        <span
          key={s.id}
          className="h-full"
          style={{
            flexGrow: s.value,
            ...(s.muted
              ? { background: 'repeating-linear-gradient(45deg, #d4d4d4 0 2px, #ececec 2px 4px)' }
              : { backgroundColor: isHexColor(s.color) ? s.color : FALLBACK_GROUP_COLOR }),
          }}
        />
      ))}
    </span>
  );
};

interface Draft {
  first_name: string;
  last_name: string;
  email: string;
  group_name: string;
}

export const RegistrationPageDetail = () => {
  const { t, lang } = useI18n();
  const { project } = useProjectContext();
  const { groups, find: findGroup, reload: reloadGroups } = useProjectGroups();
  const { pageId } = useParams();
  const navigate = useNavigate();

  const [page, setPage] = useState<RegistrationPage | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  // The project's members, to flag registrations of people it already has.
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ first_name: '', last_name: '', email: '', group_name: '' });
  const [toDelete, setToDelete] = useState<Registration | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [selectionOpen, setSelectionOpen] = useState(false);
  // Group filter, shared by the table's dropdown and the distribution chart.
  const [groupFilter, setGroupFilter] = useState('');
  const tf = useTableFilters();
  const [distributionOpen, setDistributionOpen] = useState(
    () => localStorage.getItem(DISTRIBUTION_OPEN_KEY) === '1',
  );
  const toggleDistribution = () =>
    setDistributionOpen((open) => {
      localStorage.setItem(DISTRIBUTION_OPEN_KEY, open ? '0' : '1');
      return !open;
    });

  const load = useCallback(async () => {
    const [pageResult, regsResult, membersResult] = await Promise.all([
      api.from('registration_pages').select('*').eq('id', pageId).maybeSingle(),
      api
        .from('registrations')
        .select('*')
        .eq('registration_page_id', pageId)
        .order('created_at', { ascending: false }),
      api.from('members').select('*').eq('project_id', project.id).order('created_at', { ascending: true }),
    ]);
    setPage((pageResult.data as RegistrationPage | null) ?? null);
    setRegistrations((regsResult.data as Registration[] | null) ?? []);
    setMembers((membersResult.data as Member[] | null) ?? []);
    setLoading(false);
  }, [pageId, project.id]);

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

  // A group the project doesn't have blocks the transfer until it's corrected
  // or created (enforced by the server as well).
  const isBlocked = (r: Registration) => !r.transferred && Boolean(r.group_name) && !findGroup(r.group_name);
  const pendingCount = registrations.filter((r) => !r.transferred).length;
  const transferable = registrations.filter((r) => !r.transferred && !isBlocked(r));
  const blockedCount = pendingCount - transferable.length;

  const createGroup = async (name: string) => {
    setBusy(true);
    await api.from('project_groups').insert({
      project_id: project.id,
      name: name.trim(),
      color: paletteColor(groups.length),
      position: groups.reduce((max, g) => Math.max(max, g.position + 1), 0),
    });
    await reloadGroups();
    setBusy(false);
  };

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
    const ids = transferable.filter((r) => selectedIds.includes(r.id)).map((r) => r.id);
    await Promise.all(ids.map((id) => api.rpc('transfer_registration', { p_registration_id: id })));
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
              editingId === r.id ? (
                <Select
                  value={draft.group_name}
                  onChange={(e) => setDraft((d) => ({ ...d, group_name: e.target.value }))}
                  className="py-1.5 text-sm"
                >
                  <option value="">—</option>
                  {draft.group_name && !findGroup(draft.group_name) && (
                    <option value={draft.group_name}>{draft.group_name}</option>
                  )}
                  {groups.map((g) => (
                    <option key={g.id} value={g.name}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              ) : isBlocked(r) ? (
                <span className="inline-flex flex-col items-start gap-1">
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-accent px-2 py-0.5 text-xs font-medium text-accent">
                    <AlertTriangle size={12} />
                    {r.group_name}
                  </span>
                  <span className="text-xs text-text-secondary">
                    {t('unknownGroupHint')} ·{' '}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void createGroup(r.group_name!)}
                      className="font-medium text-text underline underline-offset-2 hover:text-accent"
                    >
                      {t('createThisGroup')}
                    </button>
                  </span>
                </span>
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
      render: (r) => {
        const existing = r.transferred ? null : findMatchingMember(r, members);
        return r.transferred ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-success-soft px-2 py-0.5 text-xs font-semibold text-success-strong">
            <Check size={12} />
            {t('transferred')}
          </span>
        ) : (
          <span className="inline-flex flex-col items-start gap-1">
            <span className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-0.5 text-xs font-semibold text-text-secondary">
              {t('notTransferred')}
            </span>
            {existing && (
              <span
                title={t('alreadyMemberHint').replace('{name}', `${existing.first_name} ${existing.last_name}`)}
                className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary"
              >
                <UserCheck size={12} />
                {existing.status === 'active' ? t('alreadyMember') : t('alreadyMemberArchived')}
              </span>
            )}
          </span>
        );
      },
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

  // Group key of a registration: a project group's id, "none" or "unknown".
  const groupKey = (r: Registration) =>
    !r.group_name ? 'none' : (findGroup(r.group_name)?.id ?? 'unknown');

  const groupCounts = new Map<string, number>();
  for (const r of registrations) groupCounts.set(groupKey(r), (groupCounts.get(groupKey(r)) ?? 0) + 1);

  const slices: DonutSlice[] = [
    ...groups.map((g) => ({ id: g.id, label: g.name, value: groupCounts.get(g.id) ?? 0, color: g.color })),
    ...(groupCounts.get('unknown')
      ? [{ id: 'unknown', label: t('unknownGroupsSlice'), value: groupCounts.get('unknown')!, color: FALLBACK_GROUP_COLOR }]
      : []),
    ...(groupCounts.get('none')
      ? [{ id: 'none', label: t('noGroupAssigned'), value: groupCounts.get('none')!, color: '', muted: true }]
      : []),
  ];
  const showDistribution = page.ask_group && registrations.length > 0;

  const filters = tf.bind<Registration>([
    ...(page.ask_group
      ? [
          {
            id: 'group',
            label: t('group'),
            options: slices.map((sl) => ({ value: sl.id, label: sl.label })),
            predicate: (r: Registration, v: string) => groupKey(r) === v,
            value: groupFilter,
            onChange: setGroupFilter,
          },
        ]
      : []),
    {
      id: 'transferred',
      label: t('status'),
      options: [
        { value: 'pending', label: t('notTransferred') },
        { value: 'done', label: t('transferred') },
      ],
      predicate: (r, v) => (v === 'done' ? r.transferred : !r.transferred),
    },
  ]);

  const state = registrationState(page);

  return (
    <>
      <button
        onClick={() => navigate(`/projects/${project.id}/registrations`)}
        className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text"
      >
        <ArrowLeft size={16} />
        {t('registrationPages')}
      </button>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold sm:text-2xl">{page.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-text-secondary">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium',
                state === 'active' ? 'bg-success-soft text-success-strong' : 'bg-surface-muted text-text-secondary',
              )}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  state === 'active' ? 'bg-success' : state === 'closed' ? 'bg-accent' : 'bg-text-tertiary',
                )}
              />
              {state === 'active'
                ? t('active')
                : state === 'closed'
                  ? t('registrationClosedStatus')
                  : t('registrationInactiveStatus')}
            </span>
            {page.source === 'form' && page.closes_at && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock size={14} />
                {(state === 'closed' ? t('registrationEndedOn') : t('registrationOpenUntil')).replace(
                  '{date}',
                  formatDeadline(page.closes_at, lang),
                )}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              {page.source === 'webhook' ? <Webhook size={14} /> : <FileText size={14} />}
              {page.source === 'webhook' ? t('sourceWebhook') : t('sourceForm')}
            </span>
            {page.auto_transfer && (
              <span className="inline-flex items-center gap-1.5">
                <Zap size={14} />
                {t('autoTransfer')}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:flex-shrink-0">
          <HeaderAction
            icon={Settings}
            label={t('settings')}
            variant="secondary"
            onClick={() => navigate(`/projects/${project.id}/registrations/${page.id}/settings`)}
          />
          <Button variant={page.is_active ? 'accent' : 'primary'} disabled={busy} onClick={toggleActive}>
            {page.is_active ? <Square size={15} /> : <Play size={16} />}
            {page.is_active ? t('deactivate') : t('activate')}
          </Button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3 sm:gap-4">
        <Stat label={t('registrations')} value={registrations.length} />
        <Stat label={t('notTransferred')} value={pendingCount} highlight={pendingCount > 0} />
        <Stat label={t('transferred')} value={registrations.length - pendingCount} />
      </div>

      {blockedCount > 0 && (
        <div className="mb-6 flex items-start gap-2.5 rounded-md border border-accent bg-surface px-4 py-3 text-sm">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-accent" />
          <span>{t('unknownGroupsBlocked').replace('{n}', String(blockedCount))}</span>
        </div>
      )}

      {showDistribution && (
        <Card className="mb-6 p-0">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
            <button
              type="button"
              aria-expanded={distributionOpen}
              onClick={toggleDistribution}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <ChevronDown
                size={16}
                className={cn(
                  'flex-shrink-0 text-text-secondary transition-transform duration-150',
                  !distributionOpen && '-rotate-90',
                )}
              />
              <span className="flex-shrink-0 text-base font-medium">{t('groupDistribution')}</span>
              {distributionOpen ? (
                <span className="hidden truncate text-sm text-text-secondary sm:inline">
                  {t('registrationGroupDistributionHint')}
                </span>
              ) : (
                <DistributionBar slices={slices} />
              )}
            </button>
            {groupFilter && (
              <button
                type="button"
                onClick={() => setGroupFilter('')}
                className="inline-flex flex-shrink-0 items-center gap-1.5 text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text"
              >
                <X size={15} />
                <span className="hidden sm:inline">{t('showAllGroups')}</span>
              </button>
            )}
          </div>
          {distributionOpen && (
            <div className="border-t border-border px-4 py-5 sm:px-6">
              <GroupDonut
                slices={slices}
                layout="wide"
                selectedId={groupFilter || null}
                totalLabel={t('registrations')}
                mutedSelectable
                onSelect={(slice) => setGroupFilter((current) => (current === slice.id ? '' : slice.id))}
              />
            </div>
          )}
        </Card>
      )}

      <DataTable
        rows={registrations}
        columns={columns}
        getRowId={(r) => r.id}
        search={(r) => `${r.first_name} ${r.last_name} ${r.email ?? ''} ${r.group_name ?? ''}`}
        filters={filters}
        query={tf.query}
        hideToolbar
        toolbar={
          <>
            <TableFilterMenu query={tf.query} onQueryChange={tf.setQuery} filters={filters} />
            {selectedIds.length > 0 ? (
              <>
                <span className="text-sm text-text-secondary">
                  {t('selectedCount').replace('{n}', String(selectedIds.length))}
                </span>
                <HeaderAction
                  icon={UserPlus}
                  label={t('transferToMembers')}
                  variant="secondary"
                  disabled={busy}
                  onClick={bulkTransfer}
                />
                <HeaderAction
                  icon={Trash2}
                  label={t('delete')}
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setBulkDeleteOpen(true)}
                />
              </>
            ) : (
              <>
                <HeaderAction
                  icon={Shuffle}
                  label={t('transferSelection')}
                  variant="secondary"
                  disabled={busy || transferable.length === 0}
                  onClick={() => setSelectionOpen(true)}
                />
                <Button className="h-9" disabled={busy || transferable.length === 0} onClick={transferAll}>
                  <Users size={16} />
                  {t('transferAllToMembers')}
                  {transferable.length > 0 ? ` (${transferable.length})` : ''}
                </Button>
              </>
            )}
          </>
        }
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
                <RowActionButton
                  label={isBlocked(r) ? t('unknownGroupBlocksTransfer') : t('transferToMembers')}
                  disabled={busy || isBlocked(r)}
                  onClick={() => transferOne(r)}
                >
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
        pending={transferable}
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

const Stat = ({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) => (
  <Card className="px-4 py-3 sm:px-5 sm:py-4">
    <p className="truncate text-xs text-text-secondary sm:text-sm">{label}</p>
    <p className={cn('mt-0.5 text-xl font-bold tabular-nums sm:text-2xl', highlight && 'text-accent')}>{value}</p>
  </Card>
);
