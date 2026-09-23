import { NavLink } from 'react-router-dom';
import { AlertTriangle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSidebar } from './Sidebar';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  warningCount?: number;
}

export const SidebarNavItem = ({ to, label, icon: Icon, end, warningCount = 0 }: NavItem) => {
  const { collapsed } = useSidebar();
  const hasWarning = warningCount > 0;
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? `${label}${hasWarning ? ` (${warningCount})` : ''}` : undefined}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-150',
          collapsed && 'justify-center px-0',
          isActive ? 'bg-[#f0f0f0] text-text' : 'text-text-secondary hover:bg-[#f5f5f5]',
        )
      }
    >
      <span className="relative flex-shrink-0">
        <Icon size={18} />
        {collapsed && hasWarning ? (
          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#dc2626]" />
        ) : null}
      </span>
      {!collapsed ? (
        <>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {hasWarning ? (
            <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-[#fef2f2] px-1.5 py-0.5 text-xs font-semibold text-[#b91c1c]">
              <AlertTriangle size={12} />
              {warningCount}
            </span>
          ) : null}
        </>
      ) : null}
    </NavLink>
  );
};
