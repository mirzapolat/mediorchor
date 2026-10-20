import { Outlet } from 'react-router-dom';
import { Building2, LockKeyhole, Mail, Palette, ScrollText, ShieldCheck, ShieldHalf, Users } from 'lucide-react';
import { SidebarSectionHeader } from '@/components/SidebarSectionHeader';
import { MobileContext, NavShell } from '@/components/NavShell';
import { returnPath } from '@/lib/navReturn';
import { useAuth } from '@/hooks/useAuth';
import { NoAccess } from '@/components/NoAccess';
import { useI18n } from '@/lib/i18n';

export const AdminLayout = () => {
  const { t } = useI18n();
  const { isAdmin } = useAuth();

  if (!isAdmin) return <NoAccess standalone />;

  return (
    <NavShell
      header={<SidebarSectionHeader icon={ShieldCheck} title={t('adminSettings')} />}
      items={[
        { to: '/admin/users', label: t('users'), icon: Users },
        { to: '/admin/branding', label: t('branding'), icon: Palette },
        { to: '/admin/security', label: t('adminSecurity'), icon: LockKeyhole },
        { to: '/admin/imprint', label: t('imprint'), icon: Building2 },
        { to: '/admin/privacy', label: t('privacyPolicy'), icon: ShieldHalf },
        { to: '/admin/email', label: t('emailSection'), icon: Mail },
        { to: '/admin/audit', label: t('auditLog'), icon: ScrollText },
      ]}
      // Back to where the settings were opened from (header icon), else home.
      back={{ to: returnPath('admin'), label: t('back') }}
      context={<MobileContext icon={ShieldCheck} title={t('adminSettings')} />}
      contentClassName="max-w-[1400px] p-4 sm:p-6 lg:p-8"
    >
      <Outlet />
    </NavShell>
  );
};
