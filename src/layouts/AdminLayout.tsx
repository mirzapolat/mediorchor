import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, LockKeyhole, Mail, Palette, ShieldCheck, ShieldHalf, Users } from 'lucide-react';
import { SidebarNavItem } from '@/components/SidebarNav';
import { SidebarFooter } from '@/components/SidebarFooter';
import { Sidebar, useSidebar } from '@/components/Sidebar';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';
import { FadingText } from '@/components/FadingText';
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
        {!collapsed ? <FadingText className="font-semibold">{t('adminSettings')}</FadingText> : null}
      </div>
    </>
  );
};

export const AdminLayout = () => {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="flex h-full">
      <Sidebar>
        <AdminHeader onBack={() => navigate('/')} />

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
