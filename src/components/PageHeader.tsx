import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export const PageHeader = ({ title, subtitle, actions }: PageHeaderProps) => (
  <div className="flex items-start justify-between gap-4 mb-6">
    <div>
      <h1 className="text-2xl font-bold">{title}</h1>
      {subtitle && <p className="text-text-secondary text-sm mt-1">{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
  </div>
);
