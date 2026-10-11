import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { useSidebar } from './Sidebar';
import { FadingText } from './FadingText';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

// Top of a settings section's own sidebar (admin, account): a back link to the
// start page (for a participant of a single project: that project, named),
// then the section's icon and title.
export const SidebarSectionHeader = ({ icon: Icon, title }: { icon: LucideIcon; title: string }) => {
  const { t } = useI18n();
  const { collapsed } = useSidebar();
  const navigate = useNavigate();
  const { soleProjectId } = useAuth();
  const [projectName, setProjectName] = useState<string | null>(null);

  useEffect(() => {
    if (!soleProjectId) return;
    let cancelled = false;
    void api
      .from('projects')
      .select('name')
      .eq('id', soleProjectId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setProjectName((data as { name: string } | null)?.name ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [soleProjectId]);

  const backLabel = (soleProjectId && projectName) || t('back');

  return (
    <>
      <button
        onClick={() => navigate('/')}
        title={collapsed ? backLabel : undefined}
        className={cn(
          'flex h-14 items-center border-b border-border text-sm font-medium text-text-secondary transition-colors hover:text-text',
          collapsed ? 'justify-center px-0' : 'gap-2 px-5',
        )}
      >
        <ArrowLeft size={16} />
        {!collapsed ? <FadingText>{backLabel}</FadingText> : null}
      </button>

      <div
        className={cn(
          'flex items-center border-b border-border',
          collapsed ? 'justify-center py-4' : 'gap-2.5 px-5 py-4',
        )}
      >
        <Icon size={collapsed ? 22 : 19} className="text-text-secondary" />
        {!collapsed ? <FadingText className="font-semibold">{title}</FadingText> : null}
      </div>
    </>
  );
};
