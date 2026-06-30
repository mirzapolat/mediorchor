import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, Users } from 'lucide-react';
import { SidebarNavItem } from '@/components/SidebarNav';
import { SidebarFooter } from '@/components/SidebarFooter';
import { Sidebar, useSidebar } from '@/components/Sidebar';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';

const AdminHeader = ({ onBack }: { onBack: () => void }) => {
  const { t } = useI18n();
  const { collapsed } = useSidebar();

  return (
    <>
      <button
        onClick={onBack}
        title={collapsed ? t('back') : undefined}
        className={cn(
          'flex h-14 items-center border-b border-border text-sm font-medium text-text-secondary transition-colors hover:text-text',
          collapsed ? 'justify-center px-0' : 'gap-2 px-5',
        )}
      >
        <ArrowLeft size={16} />
        {!collapsed ? <span>{t('back')}</span> : null}
      </button>

      <div
        className={cn(
          'flex items-center border-b border-border',
          collapsed ? 'justify-center py-4' : 'gap-2.5 px-5 py-4',
        )}
      >
        <ShieldCheck size={collapsed ? 22 : 19} className="text-text-secondary" />
        {!collapsed ? <span className="truncate font-semibold">{t('adminSettings')}</span> : null}
      </div>
    </>
  );
};

export const AdminLayout = () => {
  const { t } = useI18n();
  const { isOwner } = useAuth();
  const navigate = useNavigate();

  if (!isOwner) return <Navigate to="/" replace />;

  return (
    <div className="flex h-full">
      <Sidebar>
        <AdminHeader onBack={() => navigate('/')} />

        <div className="flex-1 space-y-1 overflow-y-auto p-3">
          <SidebarNavItem to="/admin/users" label={t('users')} icon={Users} />
        </div>

        <SidebarFooter showAdminConfig={false} />
      </Sidebar>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[1400px] p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
