import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

// An on/off switch with its label next to it — or, with `icon`, a small
// icon in its place (the label stays for screen readers and the tooltip).
export const Switch = ({
  checked,
  onChange,
  label,
  title,
  icon: Icon,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  title?: string;
  icon?: LucideIcon;
  className?: string;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={Icon ? label : undefined}
    title={title ?? (Icon ? label : undefined)}
    onClick={() => onChange(!checked)}
    className={cn(
      'inline-flex h-8 flex-shrink-0 items-center rounded-md text-xs font-medium text-text-secondary hover:text-text',
      Icon ? 'gap-1 px-1' : 'gap-1.5 px-1.5',
      className,
    )}
  >
    {Icon && <Icon size={13} aria-hidden className={checked ? 'text-text' : 'text-text-tertiary'} />}
    <span
      aria-hidden
      className={cn(
        'relative h-4 w-7 rounded-full transition-colors duration-150',
        checked ? 'bg-black' : 'bg-border-strong',
      )}
    >
      <span
        className={cn(
          'absolute left-0 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-150',
          checked ? 'translate-x-3.5' : 'translate-x-0.5',
        )}
      />
    </span>
    {!Icon && label}
  </button>
);
