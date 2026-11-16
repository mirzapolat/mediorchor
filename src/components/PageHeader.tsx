import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  // Keep title and actions on one row on phones too (for compact icon
  // actions). The row wraps like the files page's: a search field
  // (`TableFilterMenu`, `order-last w-full sm:…`) drops to a line of its
  // own below the title on phones.
  inlineActions?: boolean;
}

export const PageHeader = ({ title, subtitle, actions, inlineActions }: PageHeaderProps) =>
  inlineActions ? (
    <div className={`mb-6 flex flex-wrap gap-2 ${subtitle ? 'items-center sm:items-start' : 'items-center'}`}>
      <div className="min-w-0 flex-1 basis-0 pr-1">
        <h1 className="text-xl font-bold sm:text-2xl">{title}</h1>
        {subtitle && <p className="text-text-secondary text-sm mt-1">{subtitle}</p>}
      </div>
      {actions}
    </div>
  ) : (
    <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-bold sm:text-2xl">{title}</h1>
        {subtitle && <p className="text-text-secondary text-sm mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
