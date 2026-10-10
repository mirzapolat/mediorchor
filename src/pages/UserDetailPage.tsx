import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Check, Clock, Crown, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Avatar } from '@/components/Avatar';
import { PageSpinner } from '@/components/Spinner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { UserProjectsCard } from '@/components/UserProjectsCard';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';
import { ROLES, ROLE_HINT, ROLE_LABEL } from '@/lib/roles';
import type { AppUser, UserRole } from '@/types';

export const UserDetailPage = () => {
  const { t } = useI18n();
  const { userId } = useParams();
  const navigate = useNavigate();
  const { user: me, isAdmin } = useAuth();
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [twoFactor, setTwoFactor] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  // Bumped after access changes so the projects list reloads.
  const [reloadKey, setReloadKey] = useState(0);

  const load = async () => {
    const [{ data }, mfa] = await Promise.all([
      api.from('app_users').select('*').eq('id', userId).maybeSingle(),
      api.rpc('two_factor_users'),
    ]);
    setTwoFactor(((mfa.data as string[] | null) ?? []).includes(userId ?? ''));
    setUser((data as AppUser) ?? null);
    setLoading(false);
    setReloadKey((k) => k + 1);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!isAdmin) return <Navigate to="/" replace />;
  if (loading) return <PageSpinner />;
  if (!user) {
    navigate('/admin/users');
    return null;
  }

  const isSelf = me?.id === user.id;

  // Nobody changes their own role (the server refuses it as well), so an
  // admin can't lock themselves out.
  const setRole = async (role: UserRole) => {
    if (isSelf || role === user.role) return;
    const previous = user.role;
    setError(null);
    setUser({ ...user, role });
    const { error: roleError } = await api.from('app_users').update({ role }).eq('id', user.id);
    if (roleError) {
      setUser({ ...user, role: previous });
      setError(roleError.message);
    }
  };

  const approve = async () => {
    const { error: approveError } = await api.from('app_users').update({ approved: true }).eq('id', user.id);
    if (approveError) setError(approveError.message);
    else setUser({ ...user, approved: true });
  };

  // Deactivating is the reverse of approving: the account keeps its data but
  // can't sign in, and its open sessions stop working (server/auth.ts).
  const deactivate = async () => {
    setConfirmDeactivate(false);
    const { error: deactivateError } = await api.from('app_users').update({ approved: false }).eq('id', user.id);
    if (deactivateError) setError(deactivateError.message);
    else setUser({ ...user, approved: false });
  };

  const deleteUser = async () => {
    setError(null);
    // Accounts are deleted server-side behind an admin check (server/admin.ts).
    const { error } = await api.functions.invoke('admin-delete-user', {
      body: { userId: user.id },
    });
    setConfirmDelete(false);
    if (error) {
      setError(error.message);
      return;
    }
    navigate('/admin/users');
  };

  return (
    <>
      <button
        onClick={() => navigate('/admin/users')}
        className="flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-text transition-colors duration-150 mb-6"
      >
        <ArrowLeft size={16} />
        {t('users')}
      </button>

      <div className="flex items-center gap-4 mb-6">
        <Avatar name={user.name} photoUrl={user.photo_url} size={64} />
        <div>
          <h1 className="text-2xl font-bold inline-flex items-center gap-2">
            {user.name}
            {user.role === 'admin' && <Crown size={20} className="text-accent" />}
          </h1>
          <p className="text-text-secondary text-sm mt-1">{user.email}</p>
        </div>
      </div>

      {error && <p className="text-sm text-accent mb-4">{error}</p>}

      {!user.approved && (
        <Card className="max-w-xl mb-6 flex flex-col gap-3 border-accent sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Clock size={18} className="mt-0.5 flex-shrink-0 text-accent" />
            <div>
              <p className="font-medium">{t('accountInactive')}</p>
              <p className="text-sm text-text-secondary mt-0.5">{t('accountInactiveHint')}</p>
            </div>
          </div>
          <Button className="sm:flex-shrink-0" onClick={() => void approve()}>
            <Check size={15} />
            {t('approveAccount')}
          </Button>
        </Card>
      )}

      <Card className="max-w-xl mb-6">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-sm text-text-secondary">{t('firstName')}</dt>
            <dd className="mt-0.5 font-medium break-words">{user.first_name || '—'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm text-text-secondary">{t('lastName')}</dt>
            <dd className="mt-0.5 font-medium break-words">{user.last_name || '—'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm text-text-secondary">{t('email')}</dt>
            <dd className="mt-0.5 font-medium break-all">{user.email}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm text-text-secondary">{t('twoFactorAuth')}</dt>
            <dd
              className={`mt-0.5 inline-flex items-center gap-1.5 font-medium ${twoFactor ? 'text-success' : 'text-text-secondary'}`}
            >
              {twoFactor ? <ShieldCheck size={16} /> : <ShieldOff size={16} />}
              {twoFactor ? t('twoFactorOn') : t('twoFactorOff')}
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="max-w-xl">
        <p className="font-medium">{t('role')}</p>
        <p className="text-sm text-text-secondary mt-0.5">{isSelf ? t('roleSelfHint') : t('roleHint')}</p>
        <div role="radiogroup" aria-label={t('role')} className="mt-4 space-y-2">
          {ROLES.map((role) => {
            const selected = user.role === role;
            return (
              <label
                key={role}
                className={cn(
                  'flex items-start gap-3 rounded-md border px-3 py-2.5 transition-colors duration-150',
                  selected ? 'border-text' : 'border-border',
                  isSelf ? 'cursor-default opacity-70' : 'cursor-pointer hover:bg-surface-muted',
                )}
              >
                <input
                  type="radio"
                  name="user-role"
                  className="mt-0.5 h-4 w-4 accent-black"
                  checked={selected}
                  disabled={isSelf}
                  onChange={() => void setRole(role)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t(ROLE_LABEL[role])}</span>
                  <span className="mt-0.5 block text-sm text-text-secondary">{t(ROLE_HINT[role])}</span>
                </span>
              </label>
            );
          })}
        </div>
      </Card>

      <UserProjectsCard user={user} reloadKey={reloadKey} />

      {!isSelf && (
        <Card className="max-w-xl mt-6 space-y-4">
          {user.approved && (
            <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
              <div>
                <p className="font-medium">{t('deactivateUser')}</p>
                <p className="text-sm text-text-secondary mt-0.5">{t('deactivateUserHint')}</p>
              </div>
              <Button variant="secondary" onClick={() => setConfirmDeactivate(true)} disabled={user.role === 'admin'}>
                <Ban size={15} />
                {t('deactivate')}
              </Button>
            </div>
          )}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">{t('deleteUser')}</p>
              <p className="text-sm text-text-secondary mt-0.5">{t('confirmDeleteUser')}</p>
            </div>
            <Button variant="accent" onClick={() => setConfirmDelete(true)} disabled={user.role === 'admin'}>
              <Trash2 size={15} />
              {t('delete')}
            </Button>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmDeactivate}
        title={t('deactivateUser')}
        message={`${t('confirmDeactivateUser')}\n\n${user.name} (${user.email})`}
        confirmLabel={t('deactivate')}
        destructive
        onConfirm={() => void deactivate()}
        onCancel={() => setConfirmDeactivate(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={t('deleteUser')}
        message={`${t('confirmDeleteUser')}\n\n${user.name} (${user.email})`}
        confirmLabel={t('delete')}
        destructive
        onConfirm={deleteUser}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
};
