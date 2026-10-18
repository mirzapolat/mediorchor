import { Outlet, useMatch } from 'react-router-dom';
import { NoAccess } from '@/components/NoAccess';
import { cn } from '@/lib/cn';
import { useAuth } from '@/hooks/useAuth';
import type { PieceScope } from './pieceScope';

// The collection of all pieces (dashboard tab "Stücke"): for admins and the
// 'all' pieces permission. Its piece pages are the same as inside a project.
export const GlobalPiecesLayout = () => {
  const { hasFullPieceAccess } = useAuth();
  // An open piece has its own layout (PieceLayout) from edge to edge.
  const pieceOpen = useMatch('/pieces/:pieceId/*') != null;
  if (!hasFullPieceAccess) return <NoAccess />;
  const pieceScope: PieceScope = {
    base: '/pieces',
    projectId: null,
    canEdit: true,
    canManageProject: false,
    canDelete: true,
  };
  return (
    <div className={cn(pieceOpen ? 'h-full' : 'max-w-[1400px] p-4 sm:p-6 lg:p-8')}>
      <Outlet context={{ pieceScope }} />
    </div>
  );
};
