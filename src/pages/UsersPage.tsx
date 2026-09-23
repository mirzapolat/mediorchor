import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Plus, Crown } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { PageSpinner } from '@/components/Spinner';
import { Avatar } from '@/components/Avatar';
import { DataTable, type Column, type FilterDef } from '@/components/DataTable';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { splitName } from '@/lib/accountName';
import { useAuth } from '@/hooks/useAuth';
import type { AppUser } from '@/types';

export const UsersPage = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const { data } = await api.from('app_users').select('*').order('created_at');
    setUsers((data as AppUser[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  if (!isAdmin) return <Navigate to="/" replace />;

  const createUser = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    // Accounts are created server-side behind an admin check (server/admin.ts).
    const { error } = await api.functions.invoke('admin-create-user', {
      body: { name: form.name.trim(), email: form.email.trim(), password: form.password },
    });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setFormOpen(false);
    setForm({ name: '', email: '', password: '' });
    await load();
  };

  if (loading) return <PageSpinner />;

  // 'all' = manages every project, 'partial' = selected projects, 'none' = a
  // plain participant account without management rights.
  const projectAccessState = (u: AppUser): 'all' | 'partial' | 'none' => {
    if (u.is_admin) return 'all';
    if (!u.can_manage_projects) return 'none';
    return u.all_projects ? 'all' : 'partial';
  };
  const projectAccessLabel = { all: t('accessAll'), partial: t('accessPartial'), none: t('accessNone') };
  const hasClubAccess = (u: AppUser) => u.is_admin || u.can_access_club;

  const columns: Column<AppUser>[] = [
    {
      id: 'first_name',
      header: t('firstName'),
      accessor: (u) => splitName(u.name).first,
      render: (u) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={u.name} size={28} />
          <span>{splitName(u.name).first}</span>
        </div>
      ),
    },
    {
      id: 'last_name',
      header: t('lastName'),
      accessor: (u) => splitName(u.name).last,
      render: (u) => <span>{splitName(u.name).last || '—'}</span>,
    },
    {
      id: 'email',
      header: t('email'),
      accessor: (u) => u.email,
      render: (u) => <span className="text-text-secondary">{u.email}</span>,
    },
    {
      id: 'role',
      header: t('role'),
      accessor: (u) => (u.is_admin ? 0 : 1),
      render: (u) =>
        u.is_admin ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium">
            <Crown size={15} className="text-accent" />
            {t('owner')}
          </span>
        ) : (
          <span className="text-sm text-text-secondary">{t('member')}</span>
        ),
    },
    {
      id: 'access',
      header: t('projectManagement'),
      accessor: (u) => ({ all: 0, partial: 1, none: 2 })[projectAccessState(u)],
      render: (u) => {
        const state = projectAccessState(u);
        return (
          <span
            className={`text-sm ${state === 'none' ? 'text-text-tertiary' : 'text-text-secondary'}`}
          >
            {projectAccessLabel[state]}
          </span>
        );
      },
    },
    {
      id: 'club',
      header: t('memberManagement'),
      accessor: (u) => (hasClubAccess(u) ? 0 : 1),
      render: (u) => (
        <span className={`text-sm ${hasClubAccess(u) ? 'text-text-secondary' : 'text-text-tertiary'}`}>
          {hasClubAccess(u) ? t('yes') : t('no')}
        </span>
      ),
    },
  ];

  const filters: FilterDef<AppUser>[] = [
    {
      id: 'role',
      label: t('role'),
      options: [
        { value: 'admin', label: t('owner') },
        { value: 'member', label: t('member') },
      ],
      predicate: (u, v) => (v === 'admin' ? u.is_admin : !u.is_admin),
    },
    {
      id: 'access',
      label: t('projectManagement'),
      options: [
        { value: 'all', label: t('accessAll') },
        { value: 'partial', label: t('accessPartial') },
        { value: 'none', label: t('accessNone') },
      ],
      predicate: (u, v) => projectAccessState(u) === v,
    },
    {
      id: 'club',
      label: t('memberManagement'),
      options: [
        { value: 'yes', label: t('yes') },
        { value: 'no', label: t('no') },
      ],
      predicate: (u, v) => (v === 'yes' ? hasClubAccess(u) : !hasClubAccess(u)),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('users')}
        actions={
          <Button onClick={() => setFormOpen(true)}>
            <Plus size={16} />
            {t('newUser')}
          </Button>
        }
      />

      {error && <p className="text-sm text-accent mb-4">{error}</p>}

      <DataTable
        rows={users}
        columns={columns}
        getRowId={(u) => u.id}
        onRowClick={(u) => navigate(`/admin/users/${u.id}`)}
        search={(u) => `${u.name} ${u.email}`}
        filters={filters}
        emptyMessage={t('noResults')}
      />

      <Modal
        open={formOpen}
        title={t('newUser')}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" form="user-form" disabled={saving}>
              {saving ? t('loading') : t('create')}
            </Button>
          </>
        }
      >
        <form id="user-form" onSubmit={createUser} className="space-y-4">
          <Input
            label={t('name')}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            autoFocus
          />
          <Input
            type="email"
            label={t('email')}
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <Input
            type="password"
            label={t('password')}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          {error && <p className="text-sm text-accent">{error}</p>}
        </form>
      </Modal>
    </>
  );
};
