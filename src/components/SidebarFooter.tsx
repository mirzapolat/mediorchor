import { NavLink, useNavigate } from 'react-router-dom';
import { LogOut, ShieldCheck } from 'lucide-react';
import { SidebarNavItem } from './SidebarNav';
import { useSidebar } from './Sidebar';
import { Avatar } from './Avatar';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';

// Shared bottom section for every sidebar: admin link, then an account card
// (avatar, name, email → account settings) with sign-out as an icon button.
export const SidebarFooter = ({ showAdminConfig = true }: { showAdminConfig?: boolean }) => {
  const { t } = useI18n();
  const { collapsed } = useSidebar();
  const { user, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const name = user?.name || t('account');

  const signOutButton = (
    <button
      type="button"
      onClick={handleSignOut}
      title={t('signOut')}
      aria-label={t('signOut')}
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors duration-150 hover:bg-[#fef2f2] hover:text-[#b91c1c]"
    >
      <LogOut size={16} />
    </button>
  );

  return (
    <div className="space-y-2 border-t border-border p-3">
      {showAdminConfig && isAdmin ? (
        <SidebarNavItem to="/admin" label={t('adminConfig')} icon={ShieldCheck} />
      ) : null}

      {collapsed ? (
        <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-surface py-1.5">
          <NavLink
            to="/account"
            title={name}
            className={({ isActive }) =>
              cn('rounded-full ring-offset-2 ring-offset-surface', isActive && 'ring-2 ring-black')
            }
          >
            <Avatar name={name} size={30} />
          </NavLink>
          {signOutButton}
        </div>
      ) : (
        <div className="flex items-center gap-1 rounded-xl border border-border bg-surface p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <NavLink
            to="/account"
            className={({ isActive }) =>
              cn(
                'flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-1 transition-colors duration-150 hover:bg-[#f5f5f5]',
                isActive && 'bg-[#f0f0f0]',
              )
            }
          >
            <Avatar name={name} size={32} />
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-medium text-text">{name}</span>
              {user?.email && (
                <span className="block truncate text-xs text-text-tertiary">{user.email}</span>
              )}
            </span>
          </NavLink>
          {signOutButton}
        </div>
      )}
    </div>
  );
};
