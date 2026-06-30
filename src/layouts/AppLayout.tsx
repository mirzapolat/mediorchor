import { Outlet } from 'react-router-dom';
import { FolderKanban } from 'lucide-react';
import { SidebarNavItem } from '@/components/SidebarNav';
import { SidebarFooter } from '@/components/SidebarFooter';
import { Sidebar, useSidebar } from '@/components/Sidebar';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { config } from '@/lib/config';

const AppHeader = () => {
  const { collapsed } = useSidebar();
  return (
    <div
      className={cn(
        'flex items-center h-14 border-b border-border',
        collapsed ? 'justify-center px-0' : 'gap-2.5 px-5',
      )}
    >
      <img src="/favicon.svg" alt="" className="h-5 w-5 flex-shrink-0" />
      {!collapsed && <span className="font-semibold truncate">{config.appName}</span>}
    </div>
  );
};

export const AppLayout = () => {
  const { t } = useI18n();

  return (
    <div className="flex h-full">
      <Sidebar>
        <AppHeader />

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <SidebarNavItem to="/" end label={t('projects')} icon={FolderKanban} />
        </div>

        <SidebarFooter />
      </Sidebar>

      <main className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-[1400px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
