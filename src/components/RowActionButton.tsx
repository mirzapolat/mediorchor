import type { ReactNode } from 'react';

interface RowActionButtonProps {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}

// Small square icon button used inside a table row's actions cell.
export const RowActionButton = ({ label, onClick, children, disabled }: RowActionButtonProps) => (
  <button
    type="button"
    aria-label={label}
    title={disabled ? label : undefined}
    disabled={disabled}
    onClick={onClick}
    className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-[#f0f0f0] hover:text-text transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
  >
    {children}
  </button>
);
