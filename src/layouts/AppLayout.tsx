import { Outlet } from 'react-router-dom';
import { FolderKanban, Settings, UsersRound } from 'lucide-react';
import { SidebarNavItem } from '@/components/SidebarNav';
import { SidebarFooter } from '@/components/SidebarFooter';
import { Sidebar, SidebarActionLink, useSidebar } from '@/components/Sidebar';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { config } from '@/lib/config';
import { AppLogo } from '@/components/AppLogo';
import { FadingText } from '@/components/FadingText';

// `withActions`: the header's right side holds the settings icon next to the
// collapse toggle, so leave room for both.
const AppHeader = ({ withActions }: { withActions: boolean }) => {
  const { collapsed } = useSidebar();
  return (
    <div
      className={cn(
        'flex items-center h-14 border-b border-border',
        collapsed ? 'justify-center px-0' : cn('gap-2.5 pl-5', withActions ? 'pr-20' : 'pr-12'),
      )}
    >
      <AppLogo className="h-5 w-5 flex-shrink-0" />
      {!collapsed && <FadingText className="font-semibold">{config.appName}</FadingText>}
    </div>
  );
};

export const AppLayout = () => {
  const { t } = useI18n();
  const { canAccessClub, isAdmin } = useAuth();

  return (
    <div className="flex h-full">
      {/* Admin settings live behind the gear next to the collapse toggle. */}
      <Sidebar
        actions={
          isAdmin ? <SidebarActionLink to="/admin" label={t('adminConfig')} icon={Settings} /> : undefined
        }
      >
        <AppHeader withActions={isAdmin} />

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <SidebarNavItem to="/" end label={t('projects')} icon={FolderKanban} />
          {canAccessClub && (
            <SidebarNavItem to="/club" label={t('club')} icon={UsersRound} />
          )}
        </div>

        <SidebarFooter />
      </Sidebar>

      <main className="flex-1 overflow-y-auto min-w-0 pt-14 md:pt-0">
        <Outlet />
      </main>
    </div>
  );
};
