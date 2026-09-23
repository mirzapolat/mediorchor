import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Crown, FolderKanban, Trash2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Avatar } from '@/components/Avatar';
import { PageSpinner } from '@/components/Spinner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { UserAccessModal } from '@/components/UserAccessModal';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import type { AppUser } from '@/types';

export const UserDetailPage = () => {
  const { t } = useI18n();
  const { userId } = useParams();
  const navigate = useNavigate();
  const { user: me, isAdmin, refreshUser } = useAuth();
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = async () => {
    const { data } = await api.from('app_users').select('*').eq('id', userId).maybeSingle();
    setUser((data as AppUser) ?? null);
    setLoading(false);
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

  const toggleFlag = async (flag: 'is_admin' | 'can_manage_projects' | 'can_access_club') => {
    if (!user) return;
    const next = !user[flag];
    setUser({ ...user, [flag]: next });
    await api.from('app_users').update({ [flag]: next }).eq('id', user.id);
    if (isSelf) await refreshUser();
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

  const accessLabel =
    user.is_admin || user.all_projects ? t('allProjectsAccess') : t('selectedProjects');

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
            {user.is_admin && <Crown size={20} className="text-accent" />}
          </h1>
          <p className="text-text-secondary text-sm mt-1">{user.email}</p>
        </div>
      </div>

      {error && <p className="text-sm text-accent mb-4">{error}</p>}

      <Card className="max-w-xl space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">{t('adminRights')}</p>
            <p className="text-sm text-text-secondary mt-0.5">
              {isSelf ? t('adminRightsSelfHint') : t('adminRightsHint')}
            </p>
          </div>
          <label className="inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              className="h-4 w-4 accent-black disabled:opacity-50"
              checked={user.is_admin}
              disabled={isSelf}
              onChange={() => toggleFlag('is_admin')}
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <div>
            <p className="font-medium">{t('projectManagement')}</p>
            <p className="text-sm text-text-secondary mt-0.5">{t('projectManagementHint')}</p>
          </div>
          <label className="inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              className="h-4 w-4 accent-black disabled:opacity-50"
              checked={user.is_admin || user.can_manage_projects}
              disabled={user.is_admin}
              onChange={() => toggleFlag('can_manage_projects')}
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <div>
            <p className="font-medium">{t('projectAccess')}</p>
            <p className="text-sm text-text-secondary mt-0.5">{accessLabel}</p>
          </div>
          <Button
            variant="secondary"
            onClick={() => setAccessOpen(true)}
            disabled={user.is_admin || !user.can_manage_projects}
          >
            <FolderKanban size={15} />
            {t('manageAccess')}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <div>
            <p className="font-medium">{t('clubAccess')}</p>
            <p className="text-sm text-text-secondary mt-0.5">{t('clubAccessHint')}</p>
          </div>
          <label className="inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              className="h-4 w-4 accent-black disabled:opacity-50"
              checked={user.is_admin || user.can_access_club}
              disabled={user.is_admin}
              onChange={() => toggleFlag('can_access_club')}
            />
          </label>
        </div>
      </Card>

      {!isSelf && (
        <Card className="max-w-xl mt-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">{t('deleteUser')}</p>
              <p className="text-sm text-text-secondary mt-0.5">{t('confirmDeleteUser')}</p>
            </div>
            <Button variant="accent" onClick={() => setConfirmDelete(true)} disabled={user.is_admin}>
              <Trash2 size={15} />
              {t('delete')}
            </Button>
          </div>
        </Card>
      )}

      <UserAccessModal
        user={accessOpen ? user : null}
        onClose={() => setAccessOpen(false)}
        onSaved={load}
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
