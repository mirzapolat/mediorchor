import type { LucideIcon } from 'lucide-react';
import { Button } from './Button';

// Page header button that collapses to its icon on phones, so the title and
// actions (e.g. next to a TableFilterMenu) fit on one row.
export const HeaderAction = ({
  icon: Icon,
  label,
  onClick,
  variant = 'primary',
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}) => (
  <Button
    variant={variant}
    onClick={onClick}
    aria-label={label}
    title={label}
    className="h-9 max-sm:w-9 max-sm:px-0"
  >
    <Icon size={16} />
    <span className="hidden sm:inline">{label}</span>
  </Button>
);
