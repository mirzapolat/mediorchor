import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export const PageHeader = ({ title, subtitle, actions }: PageHeaderProps) => (
  <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
    <div className="min-w-0">
      <h1 className="text-xl font-bold sm:text-2xl">{title}</h1>
      {subtitle && <p className="text-text-secondary text-sm mt-1">{subtitle}</p>}
    </div>
    {actions && (
      <div className="flex flex-wrap items-center gap-2 sm:flex-shrink-0">{actions}</div>
    )}
  </div>
);
