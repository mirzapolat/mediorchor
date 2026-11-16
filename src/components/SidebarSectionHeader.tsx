import { useEffect, useState } from 'react';
import { type LucideIcon } from 'lucide-react';
import { RAIL, sidebarLabel, useSidebar } from './Sidebar';
import { FadingText } from './FadingText';
import { SidebarBackLink } from './SidebarBackLink';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

// Top of a section's own sidebar (account, admin, notifications): a back link
// to the page before the section (else `backTo`, else the start page — for a
// participant of a single project: that project, named), then the section's
// icon and title. Icons keep their place when the sidebar collapses.
export const SidebarSectionHeader = ({
  icon: Icon,
  title,
  backTo = '/',
  scope,
}: {
  icon: LucideIcon;
  title: string;
  backTo?: string;
  // The section's base path ("/account"): back skips its own pages.
  scope: string;
}) => {
  const { t } = useI18n();
  const { collapsed } = useSidebar();
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

  return (
    <>
      <SidebarBackLink fallback={{ to: backTo, label: backLabel }} scope={scope} />

      <div className={cn('flex flex-shrink-0 items-center gap-2.5 border-b border-border py-3', RAIL.tile)}>
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-muted text-text-secondary">
          <Icon size={17} />
        </span>
        <FadingText className={cn('font-semibold', sidebarLabel(collapsed))}>{title}</FadingText>
      </div>
    </>
  );
};
