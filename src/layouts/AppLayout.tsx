import { useEffect, useState } from 'react';
import { Outlet, useLocation, useMatch } from 'react-router-dom';
import { rememberReturn } from '@/lib/navReturn';
import { CalendarDays, Layers, LayoutDashboard, Music, ShieldCheck, Trash2 } from 'lucide-react';
import { RAIL, SidebarActionLink, sidebarLabel, useSidebar } from '@/components/Sidebar';
import { NavShell } from '@/components/NavShell';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { config } from '@/lib/config';
import { AppLogo } from '@/components/AppLogo';
import { FadingText } from '@/components/FadingText';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { api, TRASH_CHANGED } from '@/lib/api';

// `withActions`: the header's right side holds the admin icon, so leave
// room for it.
const AppHeader = ({ withActions }: { withActions: boolean }) => {
  const { collapsed } = useSidebar();
  return (
    <div
      className={cn(
        'flex h-14 flex-shrink-0 items-center gap-2.5 border-b border-border',
        RAIL.icon20,
        withActions && 'pr-12',
      )}
    >
      <AppLogo className="h-5 w-5 flex-shrink-0" />
      <FadingText className={cn('font-semibold', sidebarLabel(collapsed))}>{config.appName}</FadingText>
    </div>
  );
};

// Entries in the Papierkorb the account may restore (those who manage
// projects); counted again whenever something is deleted or restored.
const useTrashCount = (enabled: boolean) => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const load = () =>
      void api.rpc('trash_count').then(({ data }) => setCount(typeof data === 'number' ? data : 0));
    load();
    window.addEventListener(TRASH_CHANGED, load);
    return () => window.removeEventListener(TRASH_CHANGED, load);
  }, [enabled]);
  return enabled ? count : 0;
};

export const AppLayout = () => {
  const { t } = useI18n();
  const { canEditCalendars, isAdmin, hasFullPieceAccess, hasDashboard, canAccessAllProjects } = useAuth();
  const trashCount = useTrashCount(canAccessAllProjects);
  const { pathname, search } = useLocation();
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
        isAdmin ? (
          <SidebarActionLink
            to="/admin"
            label={t('adminConfig')}
            icon={ShieldCheck}
            onClick={() => rememberReturn('admin', pathname + search)}
          />
        ) : undefined
      }
      items={[
        hasDashboard && { to: '/dashboard', label: t('dashboard'), icon: LayoutDashboard },
        { to: '/projects', end: true, label: t('projects'), icon: Layers },
        hasFullPieceAccess && { to: '/pieces', label: t('pieces'), icon: Music },
        canEditCalendars && { to: '/calendar', label: t('calendars'), icon: CalendarDays },
        // Only while something waits in it.
        trashCount > 0 && { to: '/trash', label: t('trash'), icon: Trash2 },
      ]}
      contentClassName=""
    >
      {/* A page that fails to load keeps the sidebar around it. */}
      <ErrorBoundary>
        <Outlet />
      </ErrorBoundary>
    </NavShell>
  );
};
