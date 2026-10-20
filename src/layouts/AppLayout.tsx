import { Outlet, useMatch } from 'react-router-dom';
import { CalendarDays, FolderKanban, LayoutDashboard, Music, ShieldCheck } from 'lucide-react';
import { SidebarActionLink, useSidebar } from '@/components/Sidebar';
import { NavShell } from '@/components/NavShell';
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
  const { canEditCalendars, isAdmin, hasFullPieceAccess, hasDashboard } = useAuth();
  // Setting up a piece takes the whole screen, without the sidebar.
  // An open piece brings its own sidebar (PieceLayout), or none in the
  // full-screen trainer.
  const pieceOpen = useMatch('/pieces/:pieceId/*') != null;

  if (pieceOpen) {
    return (
      <div className="h-full overflow-y-auto">
        <Outlet />
      </div>
    );
  }

  return (
    // Admin settings live behind the shield next to the collapse toggle.
    <NavShell
      header={<AppHeader withActions={isAdmin} />}
      sidebarActions={
        isAdmin ? <SidebarActionLink to="/admin" label={t('adminConfig')} icon={ShieldCheck} /> : undefined
      }
      items={[
        hasDashboard && { to: '/dashboard', label: t('dashboard'), icon: LayoutDashboard },
        { to: '/projects', end: true, label: t('projects'), icon: FolderKanban },
        hasFullPieceAccess && { to: '/pieces', label: t('pieces'), icon: Music },
        canEditCalendars && { to: '/calendar', label: t('calendars'), icon: CalendarDays },
      ]}
      contentClassName=""
    >
      <Outlet />
    </NavShell>
  );
};
