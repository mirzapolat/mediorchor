import { Outlet, useMatch } from 'react-router-dom';
import { NoAccess } from '@/components/NoAccess';
import { cn } from '@/lib/cn';
import { useAuth } from '@/hooks/useAuth';
import type { PieceScope } from './pieceScope';

// The collection of all pieces (dashboard tab "Stücke"): for admins and the
// 'all' pieces permission. Its piece pages are the same as inside a project.
export const GlobalPiecesLayout = () => {
  const { hasFullPieceAccess } = useAuth();
  // A piece's practice page uses the full width, like inside a project.
  const pieceOpen = useMatch('/pieces/:pieceId') != null;
  if (!hasFullPieceAccess) return <NoAccess />;
  const pieceScope: PieceScope = {
    base: '/pieces',
    projectId: null,
    canEdit: true,
    canManageProject: false,
    canDelete: true,
  };
  return (
    <div className={cn('p-4 sm:p-6 lg:p-8', !pieceOpen && 'max-w-[1400px]')}>
      <Outlet context={{ pieceScope }} />
    </div>
  );
};
