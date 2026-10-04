import { useOutletContext } from 'react-router-dom';

// Where the piece pages are opened: inside a project (its own pieces only) or
// on the collection page. The same pages serve both.
export interface PieceScope {
  // The pieces list these pages belong to: `/projects/<id>/pieces` or `/pieces`.
  base: string;
  // The project they are opened in; null on the collection page.
  projectId: string | null;
  // Edits piece content (details, files, bar markers).
  canEdit: boolean;
  // Adds, removes and orders the project's pieces (its managers).
  canManageProject: boolean;
  // Deletes pieces from the collection.
  canDelete: boolean;
}

export const usePieceScope = () => useOutletContext<{ pieceScope: PieceScope }>().pieceScope;
