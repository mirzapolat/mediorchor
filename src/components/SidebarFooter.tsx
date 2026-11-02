import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useRailTip, useSidebar } from './Sidebar';
import { Avatar } from './Avatar';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { FadingText } from './FadingText';
import { useAuth } from '@/hooks/useAuth';
import { rememberReturn } from '@/lib/navReturn';
import { NotificationBell } from './NotificationCenter';

// Shared bottom section for every sidebar: an account card (avatar, name,
// email → account settings) with the notification bell and sign-out as icon
// buttons; collapsed, the three stacked in the rail. Opening the account
// remembers the page, so its back link returns there.
export const SidebarFooter = () => {
  const { t } = useI18n();
  const { collapsed } = useSidebar();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const name = user?.name || t('account');
  const accountTip = useRailTip(name);
  const signOutTip = useRailTip(t('signOut'));

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const openAccount = () => rememberReturn('account', pathname + search);

  const signOutButton = (
    <button
      type="button"
      onClick={handleSignOut}
      title={collapsed ? undefined : t('signOut')}
      aria-label={t('signOut')}
      {...signOutTip}
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors duration-150 hover:bg-danger-soft hover:text-danger-strong"
    >
      <LogOut size={16} />
    </button>
  );

  return (
    // Keyed by the state: the other arrangement fades in while the panel
    // narrows or widens.
    <div key={collapsed ? 'rail' : 'card'} className="flex-shrink-0 animate-[fadein_200ms_ease-out] p-3">
      {collapsed ? (
        <div className="flex flex-col items-center gap-1 border-t border-border pt-3">
          <NavLink
            to="/account"
            onClick={openAccount}
            {...accountTip}
            className={({ isActive }) =>
              cn(
                'mb-1 rounded-full ring-offset-2 ring-offset-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                isActive && 'ring-2 ring-black',
              )
            }
          >
            <Avatar name={name} photoUrl={user?.photo_url} size={32} />
          </NavLink>
          <NotificationBell />
          {signOutButton}
        </div>
      ) : (
        <div className="flex items-center gap-1 rounded-xl border border-border bg-surface p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <NavLink
            to="/account"
            onClick={openAccount}
            className={({ isActive }) =>
              cn(
                'flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-1 transition-colors duration-150 hover:bg-surface-muted',
                isActive && 'bg-surface-hover',
              )
            }
          >
            <Avatar name={name} photoUrl={user?.photo_url} size={32} />
            <span className="min-w-0 leading-tight">
              <FadingText className="block text-sm font-medium text-text">{name}</FadingText>
              {user?.email && <FadingText className="block text-xs text-text-tertiary">{user.email}</FadingText>}
            </span>
          </NavLink>
          <NotificationBell />
          {signOutButton}
        </div>
      )}
    </div>
  );
};
