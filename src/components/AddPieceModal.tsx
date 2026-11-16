import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Spinner } from './Spinner';
import { useI18n } from '@/lib/i18n';
import { addPieceToProject, loadPieceCatalog } from '@/lib/pieceFiles';
import type { Piece } from '@/types';
import { matchesQuery } from '@/lib/search';
import { SearchField } from '@/components/SearchField';

type CatalogPiece = Pick<Piece, 'id' | 'name' | 'composer'>;

// Adds pieces from the collection to a project: a searchable list of the
// pieces it doesn't have yet; each tap adds one (at the end of the running
// order) and the dialog stays open for more. With `onCreateNew` it also
// offers creating a new piece.
export const AddPieceModal = ({
  open,
  projectId,
  nextPosition,
  onClose,
  onAdded,
  onCreateNew,
}: {
  open: boolean;
  projectId: string;
  nextPosition: number;
  onClose: () => void;
  onAdded: () => void;
  onCreateNew?: () => void;
}) => {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<CatalogPiece[] | null>(null);
  const [query, setQuery] = useState('');
  const [added, setAdded] = useState(0);

  useEffect(() => {
    if (!open) return;
    setCatalog(null);
    setQuery('');
    setAdded(0);
    void loadPieceCatalog(projectId).then(setCatalog);
  }, [open, projectId]);

  const add = async (piece: CatalogPiece) => {
    setCatalog((list) => list?.filter((p) => p.id !== piece.id) ?? null);
    await addPieceToProject(projectId, piece.id, nextPosition + added);
    setAdded((n) => n + 1);
    onAdded();
  };

  const shown = (catalog ?? []).filter((p) => matchesQuery(`${p.name} ${p.composer}`, query));

  return (
    <Modal
      open={open}
      title={t('addPiece')}
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          {onCreateNew ? (
            <Button variant="secondary" onClick={onCreateNew}>
              <Plus size={15} />
              {t('newPiece')}
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={onClose}>{t('done')}</Button>
        </div>
      }
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('addFromCollection')}</p>
      {catalog === null ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : catalog.length === 0 ? (
        <p className="py-4 text-sm text-text-secondary">
          {t('collectionEmptyForProject')}
          {onCreateNew && ` ${t('orCreateNew')}.`}
        </p>
      ) : (
        <>
          <SearchField autoFocus size="lg" value={query} onChange={setQuery} className="mb-2" />
          {shown.length === 0 ? (
            <p className="py-4 text-sm text-text-secondary">{t('noResults')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {shown.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => void add(p)}
                    className="group flex w-full items-center gap-3 py-2.5 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.name}</span>
                      {p.composer && <span className="block truncate text-sm text-text-secondary">{p.composer}</span>}
                    </span>
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-surface-muted text-text-secondary transition-colors duration-150 group-hover:bg-black group-hover:text-white">
                      <Plus size={16} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
};
