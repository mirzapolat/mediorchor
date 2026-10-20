import { Outlet } from 'react-router-dom';
import { Bell, CircleUserRound, KeyRound, Languages, Palette, TriangleAlert, UserRound } from 'lucide-react';
import { SidebarSectionHeader } from '@/components/SidebarSectionHeader';
import { MobileContext, NavShell } from '@/components/NavShell';
import { returnPath } from '@/lib/navReturn';
import { useI18n } from '@/lib/i18n';

// Account settings: their own sidebar with one page per section.
export const AccountLayout = () => {
  const { t } = useI18n();

  return (
    <NavShell
      header={<SidebarSectionHeader icon={CircleUserRound} title={t('account')} />}
      items={[
        { to: '/account/profile', label: t('accountProfile'), icon: UserRound },
        { to: '/account/security', label: t('loginSecurity'), icon: KeyRound },
        { to: '/account/appearance', label: t('appearance'), icon: Palette },
        { to: '/account/language', label: t('language'), icon: Languages },
        { to: '/account/notifications', label: t('accountNotifications'), icon: Bell },
        { to: '/account/danger', label: t('dangerZone'), icon: TriangleAlert },
      ]}
      // Back to where the settings were opened from (header icon), else home.
      back={{ to: returnPath('account'), label: t('back') }}
      context={<MobileContext icon={CircleUserRound} title={t('account')} />}
      contentClassName="max-w-3xl p-4 sm:p-6 lg:p-8"
    >
      <Outlet />
    </NavShell>
  );
};
