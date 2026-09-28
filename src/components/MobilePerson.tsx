import type { ReactNode } from 'react';
import { MobileMeta } from './DataTable';

// A person's row card on phones (DataTable mobileCard): photo, the full name
// (plus optional tags), and the other facts on a line below.
export const MobilePerson = ({
  avatar,
  name,
  tags,
  children,
}: {
  avatar?: ReactNode;
  name: ReactNode;
  tags?: ReactNode;
  children?: ReactNode;
}) => (
  <div className="flex min-w-0 items-start gap-3">
    {avatar && <div className="flex-shrink-0 pt-0.5">{avatar}</div>}
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 break-words text-base font-medium">{name}</span>
        {tags}
      </div>
      {children && <MobileMeta className="mt-1">{children}</MobileMeta>}
    </div>
  </div>
);
