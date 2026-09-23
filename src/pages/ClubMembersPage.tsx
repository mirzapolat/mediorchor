import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Plus, Trash2, UsersRound } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageSpinner } from '@/components/Spinner';
import { DataTable, type Column, type FilterDef } from '@/components/DataTable';
import { RowActionButton } from '@/components/RowActionButton';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import type { ClubMember } from '@/types';

export const ClubMembersPage = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [toDelete, setToDelete] = useState<ClubMember | null>(null);

  const load = useCallback(async () => {
    const { data } = await api
      .from('club_members')
      .select('*')
      .order('last_name')
      .order('first_name');
    setMembers((data as ClubMember[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async () => {
    if (!toDelete) return;
    await api.from('club_members').delete().eq('id', toDelete.id);
    setToDelete(null);
    await load();
  };

  if (loading) return <PageSpinner />;

  const columns: Column<ClubMember>[] = [
    {
      id: 'name',
      header: t('name'),
      accessor: (m) => `${m.last_name} ${m.first_name}`,
      render: (m) => <span>{[m.title, m.first_name, m.last_name].filter(Boolean).join(' ')}</span>,
    },
    {
      id: 'city',
      header: t('city'),
      accessor: (m) => m.city,
      render: (m) => <span className="text-text-secondary">{m.city ?? '—'}</span>,
    },
    {
      id: 'email',
      header: t('email'),
      accessor: (m) => m.email,
      render: (m) => <span className="text-text-secondary">{m.email ?? '—'}</span>,
    },
    {
      id: 'phone',
      header: t('phone'),
      accessor: (m) => m.phone,
      render: (m) => <span className="text-text-secondary">{m.phone ?? '—'}</span>,
    },
    {
      id: 'status',
      header: t('status'),
      accessor: (m) => m.status,
      className: 'w-px whitespace-nowrap',
      render: (m) =>
        m.status === 'active' ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success-strong">
            <span className="h-2 w-2 rounded-full bg-success" />
            {t('active')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary">
            <span className="h-2 w-2 rounded-full bg-text-tertiary" />
            {t('passive')}
          </span>
        ),
    },
  ];

  const filters: FilterDef<ClubMember>[] = [
    {
      id: 'status',
      label: t('status'),
      options: [
        { value: 'active', label: t('active') },
        { value: 'passive', label: t('passive') },
      ],
      predicate: (m, v) => m.status === v,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('members')}
        actions={
          <Button onClick={() => navigate('/club/members/new')}>
            <Plus size={16} />
            {t('newClubMember')}
          </Button>
        }
      />

      <DataTable
        rows={members}
        columns={columns}
        getRowId={(m) => m.id}
        onRowClick={(m) => navigate(`/club/members/${m.id}`)}
        search={(m) => `${m.first_name} ${m.last_name} ${m.email ?? ''} ${m.phone ?? ''} ${m.city ?? ''}`}
        filters={filters}
        emptyMessage={t('noClubMembers')}
        emptyIcon={UsersRound}
        actions={(m) => (
          <>
            <RowActionButton label={t('edit')} onClick={() => navigate(`/club/members/${m.id}`)}>
              <Pencil size={15} />
            </RowActionButton>
            <RowActionButton label={t('delete')} onClick={() => setToDelete(m)}>
              <Trash2 size={15} />
            </RowActionButton>
          </>
        )}
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
