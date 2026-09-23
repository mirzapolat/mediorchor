import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Plus, Crown, Check } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { PageSpinner } from '@/components/Spinner';
import { Avatar } from '@/components/Avatar';
import { DataTable, type Column } from '@/components/DataTable';
import { TableFilterMenu, useTableFilters } from '@/components/TableFilterMenu';
import { HeaderAction } from '@/components/HeaderAction';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { splitName } from '@/lib/accountName';
import { useAuth } from '@/hooks/useAuth';
import type { AppUser } from '@/types';

export const UsersPage = () => {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [grantedUsers, setGrantedUsers] = useState<Set<string>>(new Set());
  const [twoFactorUsers, setTwoFactorUsers] = useState<Set<string>>(new Set());
  const [lastSeen, setLastSeen] = useState<Map<string, string>>(new Map());
  const tf = useTableFilters();
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const emptyForm = { firstName: '', lastName: '', email: '', password: '' };
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [usr, access, mfa, seen] = await Promise.all([
      api.from('app_users').select('*').order('created_at'),
      api.from('user_projects').select('user_id'),
      api.rpc('two_factor_users'),
      api.rpc('last_seen'),
    ]);
    setLastSeen(
      new Map(
        ((seen.data as { user_id: string; last_seen_at: string }[] | null) ?? []).map((r) => [
          r.user_id,
          r.last_seen_at,
        ]),
      ),
    );
    setTwoFactorUsers(new Set((mfa.data as string[] | null) ?? []));
    setUsers((usr.data as AppUser[]) ?? []);
    setGrantedUsers(new Set(((access.data as { user_id: string }[]) ?? []).map((r) => r.user_id)));
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
      body: {
        name: `${form.firstName.trim()} ${form.lastName.trim()}`,
        email: form.email.trim(),
        password: form.password,
      },
    });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setFormOpen(false);
    setForm(emptyForm);
    await load();
  };

  if (loading) return <PageSpinner />;

  // 'all' = manages every project, 'partial' = individually granted projects,
  // 'none' = a plain participant account without management rights.
  const projectAccessState = (u: AppUser): 'all' | 'partial' | 'none' => {
    if (u.is_admin || u.can_manage_projects) return 'all';
    return grantedUsers.has(u.id) ? 'partial' : 'none';
  };
  const projectAccessLabel = { all: t('accessAllProjects'), partial: t('accessPartial'), none: t('accessNone') };
  const hasClubAccess = (u: AppUser) => u.is_admin || u.can_access_club;
  const hasTwoFactor = (u: AppUser) => twoFactorUsers.has(u.id);

  // Yes/no cells as a check or a dash keep the narrow columns narrow.
  const flag = (on: boolean) =>
    on ? (
      <Check size={16} className="mx-auto text-text-secondary" aria-label={t('yes')} />
    ) : (
      <span className="block text-center text-text-tertiary" aria-label={t('no')}>
        —
      </span>
    );
  const narrow = 'w-px whitespace-nowrap';
  // Date over time keeps the timestamp columns narrow.
  const locale = lang === 'de' ? 'de-DE' : 'en-GB';
  const dateTime = (iso: string) => {
    const d = new Date(iso);
    return (
      <span className="block text-sm leading-tight text-text-secondary">
        {d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: '2-digit' })}
        <span className="block text-xs text-text-tertiary">
          {d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
        </span>
      </span>
    );
  };

  const columns: Column<AppUser>[] = [
    {
      id: 'name',
      header: t('name'),
      accessor: (u) => `${splitName(u.name).last} ${splitName(u.name).first}`.toLowerCase(),
      render: (u) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar name={u.name} photoUrl={u.photo_url} size={28} />
          <div className="min-w-0">
            <p className="truncate leading-tight">{u.name}</p>
            <p className="truncate text-sm leading-tight text-text-secondary">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      id: 'role',
      header: t('role'),
      accessor: (u) => (u.is_admin ? 0 : 1),
      className: narrow,
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
      header: t('projects'),
      accessor: (u) => ({ all: 0, partial: 1, none: 2 })[projectAccessState(u)],
      className: narrow,
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
      header: t('clubShort'),
      accessor: (u) => (hasClubAccess(u) ? 0 : 1),
      className: narrow,
      render: (u) => flag(hasClubAccess(u)),
    },
    {
      id: 'two_factor',
      header: t('twoFactorShort'),
      accessor: (u) => (hasTwoFactor(u) ? 0 : 1),
      className: narrow,
      render: (u) => flag(hasTwoFactor(u)),
    },
    {
      id: 'created_at',
      header: t('accountCreated'),
      accessor: (u) => u.created_at,
      className: narrow,
      render: (u) => dateTime(u.created_at),
    },
    {
      id: 'last_seen',
      header: t('lastSeen'),
      accessor: (u) => lastSeen.get(u.id) ?? null,
      className: narrow,
      render: (u) => {
        const at = lastSeen.get(u.id);
        return at ? (
          dateTime(at)
        ) : (
          <span className="text-sm text-text-tertiary">{t('never')}</span>
        );
      },
    },
  ];

  const filters = tf.bind<AppUser>([
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
      label: t('projects'),
      options: [
        // Not just "All": the menu already offers that as "no filter".
        { value: 'all', label: t('accessAllProjects') },
        { value: 'partial', label: t('accessPartial') },
        { value: 'none', label: t('accessNone') },
      ],
      predicate: (u, v) => projectAccessState(u) === v,
    },
    {
      id: 'club',
      label: t('clubShort'),
      options: [
        { value: 'yes', label: t('yes') },
        { value: 'no', label: t('no') },
      ],
      predicate: (u, v) => (v === 'yes' ? hasClubAccess(u) : !hasClubAccess(u)),
    },
    {
      id: 'two_factor',
      label: t('twoFactorShort'),
      options: [
        { value: 'yes', label: t('yes') },
        { value: 'no', label: t('no') },
      ],
      predicate: (u, v) => (v === 'yes' ? hasTwoFactor(u) : !hasTwoFactor(u)),
    },
  ]);

  return (
    <>
      <PageHeader
        title={t('users')}
        inlineActions
        actions={
          <>
            <TableFilterMenu query={tf.query} onQueryChange={tf.setQuery} filters={filters} />
            <HeaderAction icon={Plus} label={t('newUser')} onClick={() => setFormOpen(true)} />
          </>
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
        query={tf.query}
        hideToolbar
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
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('firstName')}
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              required
              autoFocus
            />
            <Input
              label={t('lastName')}
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              required
            />
          </div>
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
