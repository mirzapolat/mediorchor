import type { ReactNode } from 'react';

interface RowActionButtonProps {
  label: string;
  onClick: () => void;
  children: ReactNode;
}

// Small square icon button used inside a table row's actions cell.
export const RowActionButton = ({ label, onClick, children }: RowActionButtonProps) => (
  <button
    type="button"
    aria-label={label}
    onClick={onClick}
    className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-[#f0f0f0] hover:text-text transition-colors duration-150"
  >
    {children}
  </button>
);
