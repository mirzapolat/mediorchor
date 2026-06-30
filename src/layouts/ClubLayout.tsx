import { Navigate, Outlet } from 'react-router-dom';
import { FileText, ScrollText, UsersRound } from 'lucide-react';
import { SidebarNavItem } from '@/components/SidebarNav';
import { Sidebar, useSidebar } from '@/components/Sidebar';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';

const ClubHeader = () => {
  const { t } = useI18n();
  const { collapsed } = useSidebar();
  return (
    <div
      className={cn(
        'flex items-center h-14 border-b border-border',
        collapsed ? 'justify-center px-0' : 'gap-2.5 px-5',
      )}
    >
      <UsersRound size={collapsed ? 20 : 18} className="text-text-secondary flex-shrink-0" />
      {!collapsed && <span className="font-semibold truncate">{t('clubMembers')}</span>}
    </div>
  );
};

// The "Vereinsmitglieder" section. It lives inside the top dashboard (the
// primary app sidebar stays visible) and adds its own secondary sidebar.
export const ClubLayout = () => {
  const { t } = useI18n();
  const { canAccessClub } = useAuth();

  if (!canAccessClub) return <Navigate to="/" replace />;

  return (
    <div className="flex h-full">
      <Sidebar storageKey="club">
        <ClubHeader />

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <SidebarNavItem to="/club/members" label={t('members')} icon={UsersRound} />
          <SidebarNavItem
            to="/club/applications"
            label={t('membershipApplications')}
            icon={FileText}
          />
          <SidebarNavItem to="/club/rules" label={t('rules')} icon={ScrollText} />
        </div>
      </Sidebar>

      <main className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-[1400px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
