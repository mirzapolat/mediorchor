import { Outlet } from 'react-router-dom';
import { Building2, LockKeyhole, Mail, Palette, ShieldCheck, ShieldHalf, Users } from 'lucide-react';
import { SidebarNavItem } from '@/components/SidebarNav';
import { SidebarFooter } from '@/components/SidebarFooter';
import { SidebarSectionHeader } from '@/components/SidebarSectionHeader';
import { Sidebar } from '@/components/Sidebar';
import { useAuth } from '@/hooks/useAuth';
import { NoAccess } from '@/components/NoAccess';
import { useI18n } from '@/lib/i18n';

export const AdminLayout = () => {
  const { t } = useI18n();
  const { isAdmin } = useAuth();

  if (!isAdmin) return <NoAccess standalone />;

  return (
    <div className="flex h-full">
      <Sidebar>
        <SidebarSectionHeader icon={ShieldCheck} title={t('adminSettings')} />

        <div className="flex-1 space-y-1 overflow-y-auto p-3">
          <SidebarNavItem to="/admin/users" label={t('users')} icon={Users} />
          <SidebarNavItem to="/admin/branding" label={t('branding')} icon={Palette} />
          <SidebarNavItem to="/admin/security" label={t('adminSecurity')} icon={LockKeyhole} />
          <SidebarNavItem to="/admin/imprint" label={t('imprint')} icon={Building2} />
          <SidebarNavItem to="/admin/privacy" label={t('privacyPolicy')} icon={ShieldHalf} />
          <SidebarNavItem to="/admin/email" label={t('emailSection')} icon={Mail} />
        </div>

        <SidebarFooter />
      </Sidebar>

      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        <div className="max-w-[1400px] p-4 sm:p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
