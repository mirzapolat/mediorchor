import { useNavigate } from 'react-router-dom';
import { LogOut, ShieldCheck, UserCircle } from 'lucide-react';
import { SidebarNavItem } from './SidebarNav';
import { useSidebar } from './Sidebar';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';

// Shared bottom section for every sidebar: admin link, account, and sign out.
export const SidebarFooter = ({ showAdminConfig = true }: { showAdminConfig?: boolean }) => {
  const { t } = useI18n();
  const { collapsed } = useSidebar();
  const { user, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="p-3 border-t border-border space-y-1">
      {showAdminConfig && isAdmin ? (
        <SidebarNavItem to="/admin" label={t('adminConfig')} icon={ShieldCheck} />
      ) : null}
      <SidebarNavItem to="/account" label={user?.name || t('account')} icon={UserCircle} />
      <button
        onClick={handleSignOut}
        title={collapsed ? t('signOut') : undefined}
        className={cn(
          'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium text-text-secondary hover:bg-[#f5f5f5] transition-colors duration-150',
          collapsed && 'justify-center px-0',
        )}
      >
        <LogOut size={18} />
        {!collapsed && <span>{t('signOut')}</span>}
      </button>
    </div>
  );
};
