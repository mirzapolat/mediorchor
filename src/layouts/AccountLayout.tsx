import { Outlet } from 'react-router-dom';
import { Bell, CircleUserRound, KeyRound, Palette, TriangleAlert, UserRound } from 'lucide-react';
import { SidebarNavItem } from '@/components/SidebarNav';
import { SidebarFooter } from '@/components/SidebarFooter';
import { SidebarSectionHeader } from '@/components/SidebarSectionHeader';
import { Sidebar } from '@/components/Sidebar';
import { useI18n } from '@/lib/i18n';

// Account settings: their own sidebar with one page per section.
export const AccountLayout = () => {
  const { t } = useI18n();

  return (
    <div className="flex h-full">
      <Sidebar>
        <SidebarSectionHeader icon={CircleUserRound} title={t('account')} />

        <div className="flex-1 space-y-1 overflow-y-auto p-3">
          <SidebarNavItem to="/account/profile" label={t('accountProfile')} icon={UserRound} />
          <SidebarNavItem to="/account/security" label={t('loginSecurity')} icon={KeyRound} />
          <SidebarNavItem to="/account/appearance" label={t('appearance')} icon={Palette} />
          <SidebarNavItem to="/account/notifications" label={t('accountNotifications')} icon={Bell} />
          <SidebarNavItem to="/account/danger" label={t('dangerZone')} icon={TriangleAlert} />
        </div>

        <SidebarFooter />
      </Sidebar>

      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        <div className="max-w-3xl p-4 sm:p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
