import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  message: string;
}

export const EmptyState = ({ icon: Icon, message }: EmptyStateProps) => (
  <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
    {Icon && <Icon size={32} className="text-text-secondary" />}
    <p className="text-text-secondary text-sm">{message}</p>
  </div>
);
