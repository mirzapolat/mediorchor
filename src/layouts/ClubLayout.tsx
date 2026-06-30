import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { FileText, ScrollText, UsersRound, type LucideIcon } from 'lucide-react';
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

// Horizontal tab shown in place of the secondary sidebar on small screens.
const MobileTab = ({ to, label, icon: Icon }: { to: string; label: string; icon: LucideIcon }) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      cn(
        'inline-flex flex-shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150',
        isActive ? 'bg-[#f0f0f0] text-text' : 'text-text-secondary hover:bg-[#f5f5f5]',
      )
    }
  >
    <Icon size={16} />
    {label}
  </NavLink>
);

// The "Vereinsmitglieder" section. On desktop it lives inside the top dashboard
// (the primary app sidebar stays visible) and adds its own secondary sidebar.
// On mobile the secondary sidebar collapses to a horizontal tab strip so the
// app's single drawer stays the only off-canvas menu.
export const ClubLayout = () => {
  const { t } = useI18n();
  const { canAccessClub } = useAuth();

  if (!canAccessClub) return <Navigate to="/" replace />;

  return (
    <div className="flex h-full">
      {/* Secondary sidebar — desktop only; the parent app drawer covers mobile. */}
      <Sidebar storageKey="club" hideMobileBar>
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

      <main className="flex-1 overflow-y-auto min-w-0">
        {/* Mobile secondary navigation. */}
        <div className="flex gap-1.5 overflow-x-auto border-b border-border bg-surface px-4 py-2 md:hidden">
          <MobileTab to="/club/members" label={t('members')} icon={UsersRound} />
          <MobileTab to="/club/applications" label={t('membershipApplications')} icon={FileText} />
          <MobileTab to="/club/rules" label={t('rules')} icon={ScrollText} />
        </div>

        <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
