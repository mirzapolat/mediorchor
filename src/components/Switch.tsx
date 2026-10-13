import { cn } from '@/lib/cn';

// An on/off switch with a visible label next to it.
export const Switch = ({
  checked,
  onChange,
  label,
  title,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  title?: string;
  className?: string;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    title={title}
    onClick={() => onChange(!checked)}
    className={cn(
      'inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-text-secondary hover:text-text',
      className,
    )}
  >
    <span
      aria-hidden
      className={cn(
        'relative h-4 w-7 rounded-full transition-colors duration-150',
        checked ? 'bg-black' : 'bg-border-strong',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-150',
          checked ? 'translate-x-3.5' : 'translate-x-0.5',
        )}
      />
    </span>
    {label}
  </button>
);
