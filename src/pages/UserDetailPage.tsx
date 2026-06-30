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
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import type { AppUser } from '@/types';

export const UserDetailPage = () => {
  const { t } = useI18n();
  const { userId } = useParams();
  const navigate = useNavigate();
  const { user: me, isOwner, refreshUser } = useAuth();
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = async () => {
    const { data } = await supabase.from('app_users').select('*').eq('id', userId).maybeSingle();
    setUser((data as AppUser) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!isOwner) return <Navigate to="/" replace />;
  if (loading) return <PageSpinner />;
  if (!user) {
    navigate('/admin/users');
    return null;
  }

  const isSelf = me?.id === user.id;
  const isOwnerUser = user.role === 'owner';

  const transferOwnership = async () => {
    if (!me) return;
    await supabase.from('app_users').update({ role: 'owner' }).eq('id', user.id);
    await supabase.from('app_users').update({ role: 'member' }).eq('id', me.id);
    setConfirmTransfer(false);
    await refreshUser();
    navigate('/');
  };

  const deleteUser = async () => {
    setError(null);
    // Deleting the auth user requires the service role, so it goes through the
    // admin-delete-user edge function (owner-only).
    const { error } = await supabase.functions.invoke('admin-delete-user', {
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
    isOwnerUser || user.all_projects ? t('allProjectsAccess') : t('selectedProjects');

  const toggleProjectsAccess = async () => {
    if (!user) return;
    const next = !user.can_access_projects;
    setUser({ ...user, can_access_projects: next });
    await supabase.from('app_users').update({ can_access_projects: next }).eq('id', user.id);
    if (isSelf) await refreshUser();
  };

  const toggleClubAccess = async () => {
    if (!user) return;
    const next = !user.can_access_club;
    setUser({ ...user, can_access_club: next });
    await supabase.from('app_users').update({ can_access_club: next }).eq('id', user.id);
    if (isSelf) await refreshUser();
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
        <Avatar name={user.name} size={64} />
        <div>
          <h1 className="text-2xl font-bold inline-flex items-center gap-2">
            {user.name}
            {isOwnerUser && <Crown size={20} className="text-accent" />}
          </h1>
          <p className="text-text-secondary text-sm mt-1">{user.email}</p>
        </div>
      </div>

      {error && <p className="text-sm text-accent mb-4">{error}</p>}

      <Card className="max-w-xl space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">{t('projectsAccess')}</p>
            <p className="text-sm text-text-secondary mt-0.5">{t('projectsAccessHint')}</p>
          </div>
          <label className="inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              className="h-4 w-4 accent-black disabled:opacity-50"
              checked={isOwnerUser || user.can_access_projects}
              disabled={isOwnerUser}
              onChange={toggleProjectsAccess}
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
            disabled={isOwnerUser || !user.can_access_projects}
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
              checked={isOwnerUser || user.can_access_club}
              disabled={isOwnerUser}
              onChange={toggleClubAccess}
            />
          </label>
        </div>
      </Card>

      {!isSelf && (
        <Card className="max-w-xl mt-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">{t('transferOwnership')}</p>
              <p className="text-sm text-text-secondary mt-0.5">{user.email}</p>
            </div>
            <Button
              variant="secondary"
              onClick={() => setConfirmTransfer(true)}
              disabled={isOwnerUser}
            >
              <Crown size={15} />
              {t('transferOwnership')}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            <div>
              <p className="font-medium">{t('deleteUser')}</p>
              <p className="text-sm text-text-secondary mt-0.5">{t('confirmDeleteUser')}</p>
            </div>
            <Button variant="accent" onClick={() => setConfirmDelete(true)} disabled={isOwnerUser}>
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
        open={confirmTransfer}
        title={t('transferOwnership')}
        message={`${t('transferOwnership')} → ${user.name} (${user.email})`}
        confirmLabel={t('confirm')}
        onConfirm={transferOwnership}
        onCancel={() => setConfirmTransfer(false)}
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
