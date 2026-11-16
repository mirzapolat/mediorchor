import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { RAIL, sidebarLabel, useRailTip, useSidebar } from './Sidebar';
import { FadingText } from './FadingText';
import { useBack } from '@/hooks/useBack';
import { cn } from '@/lib/cn';

// The back row at the top of an area's sidebar (piece, event, project,
// weekend, account …). It returns to the page the user came from before
// entering `scope` (the area's base path); with no such page in this tab's
// history, to `fallback` — the area's parent, named by its label.
export const SidebarBackLink = ({ fallback, scope }: { fallback: { to: string; label: string }; scope: string }) => {
  const { collapsed } = useSidebar();
  const back = useBack(fallback, scope);
  const tip = useRailTip(back.label);
  return (
    <Link
      to={back.to}
      onClick={back.go}
      {...tip}
      className={cn(
        'flex h-14 flex-shrink-0 items-center gap-2 border-b border-border text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text',
        RAIL.icon16,
      )}
    >
      <ArrowLeft size={16} className="flex-shrink-0" />
      <FadingText className={sidebarLabel(collapsed)}>{back.label}</FadingText>
    </Link>
  );
};
