import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { RAIL, sidebarLabel, useRailTip, useSidebar } from './Sidebar';
import { FadingText } from './FadingText';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

// Top of a section's own sidebar (account, admin, notifications): a back link
// to where the section was opened from (`backTo`; else the start page — for a
// participant of a single project: that project, named), then the section's
// icon and title. Icons keep their place when the sidebar collapses.
export const SidebarSectionHeader = ({
  icon: Icon,
  title,
  backTo = '/',
}: {
  icon: LucideIcon;
  title: string;
  backTo?: string;
}) => {
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

  const backLabel = (backTo === '/' && soleProjectId && projectName) || t('back');
  const tip = useRailTip(backLabel);

  return (
    <>
      <button
        onClick={() => navigate(backTo)}
        {...tip}
        className={cn(
          'flex h-14 flex-shrink-0 items-center gap-2 border-b border-border text-sm font-medium text-text-secondary transition-colors hover:text-text',
          RAIL.icon16,
        )}
      >
        <ArrowLeft size={16} className="flex-shrink-0" />
        <FadingText className={sidebarLabel(collapsed)}>{backLabel}</FadingText>
      </button>

      <div className={cn('flex flex-shrink-0 items-center gap-2.5 border-b border-border py-3', RAIL.tile)}>
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-muted text-text-secondary">
          <Icon size={17} />
        </span>
        <FadingText className={cn('font-semibold', sidebarLabel(collapsed))}>{title}</FadingText>
      </div>
    </>
  );
};
