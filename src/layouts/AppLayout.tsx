import { Outlet } from 'react-router-dom';
import { CalendarDays, FolderKanban, LayoutDashboard, Mail, Music, ShieldCheck, UsersRound } from 'lucide-react';
import { CLUB_ENABLED } from '@/lib/features';
import { SidebarNavItem } from '@/components/SidebarNav';
import { SidebarFooter } from '@/components/SidebarFooter';
import { Sidebar, SidebarActionLink, useSidebar } from '@/components/Sidebar';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { config } from '@/lib/config';
import { AppLogo } from '@/components/AppLogo';
import { FadingText } from '@/components/FadingText';

// `withActions`: the header's right side holds the admin icon next to the
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
  const { canAccessClub, canEditCalendars, isAdmin, hasFullPieceAccess } = useAuth();

  return (
    <div className="flex h-full">
      {/* Admin settings live behind the shield next to the collapse toggle. */}
      <Sidebar
        actions={
          isAdmin ? <SidebarActionLink to="/admin" label={t('adminConfig')} icon={ShieldCheck} /> : undefined
        }
      >
        <AppHeader withActions={isAdmin} />

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <SidebarNavItem to="/dashboard" label={t('dashboard')} icon={LayoutDashboard} />
          <SidebarNavItem to="/projects" end label={t('projects')} icon={FolderKanban} />
          {hasFullPieceAccess && <SidebarNavItem to="/pieces" label={t('pieces')} icon={Music} />}
          {canEditCalendars && <SidebarNavItem to="/calendar" label={t('calendars')} icon={CalendarDays} />}
          {CLUB_ENABLED && canAccessClub && <SidebarNavItem to="/club" label={t('club')} icon={UsersRound} />}

          {/* Preview sections (a notice for admins only), set apart by a line. */}
          {isAdmin && (
            <>
              <div role="separator" className="!my-3 border-t border-border" />
              {!CLUB_ENABLED && <SidebarNavItem to="/club" label={t('club')} icon={UsersRound} />}
              <SidebarNavItem to="/newsletter" label={t('newsletter')} icon={Mail} />
            </>
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
