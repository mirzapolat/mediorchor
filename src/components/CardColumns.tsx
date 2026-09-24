import { Children, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

// Settings cards in balanced columns: one on phones, two from `lg`. CSS
// columns let the browser place each card by its real height, so the columns
// stay even however long a card gets (more sessions, 2FA on, ...) instead of
// one hand-picked column running far past the other. Cards run down the
// first column, then the second; each card stays whole.
//
// The gap below each card is padding on a wrapper, not a margin: browsers drop
// margins at column breaks, which would glue the next section to the columns.
// A wrapper whose card renders nothing (e.g. while loading) is hidden.
export const CardColumns = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('max-w-5xl gap-6 lg:columns-2', className)}>
    {Children.map(children, (child) => (
      <div className="break-inside-avoid pb-6 empty:hidden">{child}</div>
    ))}
  </div>
);
