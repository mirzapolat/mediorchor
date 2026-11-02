import { NavLink } from 'react-router-dom';
import { AlertTriangle, Globe, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { RAIL, sidebarLabel, useRailTip, useSidebar } from './Sidebar';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  warningCount?: number;
  // A quiet count of one's own open things (e.g. surveys still to answer).
  badge?: number;
  // 'participants': participants can open the page too, shown as a small globe
  // on the right. Unset = no icon; pass it only to people with write access,
  // participants don't need the hint.
  access?: 'participants';
  accessLabel?: string;
}

// One page of the area. The icon keeps its place when the sidebar collapses
// (see RAIL); the label and counts fade, a dot on the icon stands in for the
// count and the label shows next to the rail on hover.
export const SidebarNavItem = ({ to, label, icon: Icon, end, warningCount = 0, badge = 0, access, accessLabel }: NavItem) => {
  const { collapsed } = useSidebar();
  const hasWarning = warningCount > 0;
  const tip = useRailTip(hasWarning ? `${label} (${warningCount})` : badge > 0 ? `${label} (${badge})` : label);
  return (
    <NavLink
      to={to}
      end={end}
      {...tip}
      className={({ isActive }) =>
        cn(
          'flex h-9 items-center gap-2.5 rounded-md text-sm font-medium transition-colors duration-150',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          RAIL.item,
          isActive ? 'bg-surface-hover text-text' : 'text-text-secondary hover:bg-surface-muted',
        )
      }
    >
      <span className="relative flex-shrink-0">
        <Icon size={18} />
        <span
          aria-hidden
          className={cn(
            'absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-surface transition-opacity duration-200',
            hasWarning ? 'bg-danger' : 'bg-accent',
            collapsed && (hasWarning || badge > 0) ? 'opacity-100' : 'opacity-0',
          )}
        />
      </span>
      <span className={cn('flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap', sidebarLabel(collapsed))}>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {hasWarning ? (
          <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-danger-soft px-1.5 py-0.5 text-xs font-semibold text-danger-strong">
            <AlertTriangle size={12} />
            {warningCount}
          </span>
        ) : badge > 0 ? (
          <span className="min-w-[1.25rem] flex-shrink-0 rounded-full bg-accent/20 px-1.5 text-center text-xs font-semibold text-text">
            {badge}
          </span>
        ) : null}
        {access ? (
          <span className="flex-shrink-0 text-text-tertiary opacity-70" title={accessLabel}>
            <Globe size={13} aria-hidden />
            {accessLabel ? <span className="sr-only">{accessLabel}</span> : null}
          </span>
        ) : null}
      </span>
    </NavLink>
  );
};
