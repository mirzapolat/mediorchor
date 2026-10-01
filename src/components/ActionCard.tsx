import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

// A full-width tappable card for a page-level action: round icon, title,
// one line of status underneath. Used in the pieces page's side column.
export const ActionCard = ({
  icon: Icon,
  title,
  status,
  statusTone = 'muted',
  busy,
  disabled,
  onClick,
  hint,
}: {
  icon: LucideIcon;
  title: ReactNode;
  status?: ReactNode;
  statusTone?: 'muted' | 'danger' | 'success';
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  hint?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled || busy}
    title={hint}
    className={cn(
      'group flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left transition-colors duration-150 enabled:hover:bg-surface-subtle',
      busy && 'cursor-progress',
      disabled && !busy && 'cursor-not-allowed opacity-60',
    )}
  >
    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-surface-muted text-text-secondary transition-colors duration-150 group-enabled:group-hover:bg-black group-enabled:group-hover:text-white">
      {busy ? <Loader2 size={18} className="animate-spin" /> : <Icon size={18} />}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-medium">{title}</span>
      {status && (
        <span
          className={cn(
            'block text-xs tabular-nums',
            statusTone === 'danger'
              ? 'text-danger'
              : statusTone === 'success'
                ? 'text-success-strong'
                : 'text-text-secondary',
          )}
        >
          {status}
        </span>
      )}
    </span>
  </button>
);
