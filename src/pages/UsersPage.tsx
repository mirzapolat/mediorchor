import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Plus, Check } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { PageSpinner } from '@/components/Spinner';
import { Avatar } from '@/components/Avatar';
import { DataTable, type Column } from '@/components/DataTable';
import { MobilePerson } from '@/components/MobilePerson';
import { TableFilterMenu, useTableFilters } from '@/components/TableFilterMenu';
import { HeaderAction } from '@/components/HeaderAction';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { track } from '@/lib/analytics';
import { useAuth } from '@/hooks/useAuth';
import type { AppUser } from '@/types';

export const UsersPage = () => {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [lastSeen, setLastSeen] = useState<Map<string, string>>(new Map());
  const tf = useTableFilters();
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const emptyForm = { firstName: '', lastName: '', email: '', password: '' };
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [usr, seen] = await Promise.all([
      api.from('app_users').select('*').order('created_at'),
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
    setUsers((usr.data as AppUser[]) ?? []);
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
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim(),
        email: form.email.trim(),
        password: form.password,
      },
    });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    track('account-created');
    setFormOpen(false);
    setForm(emptyForm);
    await load();
  };

  if (loading) return <PageSpinner />;

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
      accessor: (u) => `${u.last_name} ${u.first_name}`.toLowerCase(),
      render: (u) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar name={u.name} photoUrl={u.photo_url} size={28} />
          <div className="min-w-0">
            <p className="flex items-center gap-2 leading-tight">
              <span className="truncate">{u.name}</span>
              {!u.approved && (
                <span className="flex-shrink-0 rounded-md bg-accent/15 px-1.5 py-0.5 text-xs font-semibold text-accent">
                  {t('approvalPending')}
                </span>
              )}
            </p>
          </div>
        </div>
      ),
    },
    {
      id: 'email',
      header: t('email'),
      accessor: (u) => u.email.toLowerCase(),
      render: (u) => <span className="block truncate text-sm text-text-secondary">{u.email}</span>,
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
    {
      id: 'admin',
      header: t('owner'),
      accessor: (u) => (u.is_admin ? 0 : 1),
      className: narrow,
      render: (u) => flag(u.is_admin),
    },
  ];

  const filters = tf.bind<AppUser>([
    {
      id: 'approval',
      label: t('accountStatus'),
      options: [
        { value: 'approved', label: t('approvedAccount') },
        { value: 'pending', label: t('approvalPending') },
      ],
      predicate: (u, v) => (v === 'pending' ? !u.approved : u.approved),
    },
    {
      id: 'admin',
      label: t('owner'),
      options: [
        { value: 'yes', label: t('yes') },
        { value: 'no', label: t('no') },
      ],
      predicate: (u, v) => (v === 'yes' ? u.is_admin : !u.is_admin),
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
        // Phones: photo, name and email, then admin (when on) and when last
        // seen, as compact facts.
        mobileCard={(u) => {
          const at = lastSeen.get(u.id);
          return (
            <MobilePerson
              avatar={<Avatar name={u.name} photoUrl={u.photo_url} size={36} />}
              name={u.name}
              tags={
                !u.approved && (
                  <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-xs font-semibold text-accent">
                    {t('approvalPending')}
                  </span>
                )
              }
            >
              <span className="w-full min-w-0 break-all">{u.email}</span>
              {u.is_admin && (
                <span className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-1.5 py-0.5 text-xs font-medium">
                  <Check size={12} />
                  {t('owner')}
                </span>
              )}
              <span className="text-xs text-text-tertiary">
                {t('lastSeen')}:{' '}
                {at
                  ? new Date(at).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: '2-digit' })
                  : t('never')}
              </span>
            </MobilePerson>
          );
        }}
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
