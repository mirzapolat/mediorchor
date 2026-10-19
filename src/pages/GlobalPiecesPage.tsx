import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, ArchiveRestore, Music, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { PageSpinner } from '@/components/Spinner';
import { RowActionButton } from '@/components/RowActionButton';
import { TableFilterMenu, useTableFilters } from '@/components/TableFilterMenu';
import { HeaderAction } from '@/components/HeaderAction';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PieceForm } from '@/components/PieceForm';
import { SortableList } from '@/components/SortableList';
import { PieceTableHeader, PieceTableRow } from '@/components/PieceTable';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { deletePiece, loadPiecesWithRecordings } from '@/lib/pieceFiles';
import type { Piece, PieceCredit } from '@/types';

const ACTIONS_WIDTH = 'w-[4.5rem]';

// The collection of all pieces, shared by every project (dashboard tab
// "Stücke", admins and the 'all' pieces permission), as the same table as a
// project's pieces: create, archive and delete pieces here; projects pick
// theirs from it. The search also finds the people credited.
export const GlobalPiecesPage = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [credits, setCredits] = useState<PieceCredit[]>([]);
  const [withRecordings, setWithRecordings] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Piece | null>(null);
  const tf = useTableFilters({ status: 'active' });

  const load = useCallback(async () => {
    const [pieceResult, creditResult, recordings] = await Promise.all([
      api.from('pieces').select('*').order('name'),
      api.from('piece_credits').select('*').order('position').order('created_at'),
      loadPiecesWithRecordings(),
    ]);
    setPieces((pieceResult.data as Piece[] | null) ?? []);
    setCredits((creditResult.data as PieceCredit[] | null) ?? []);
    setWithRecordings(recordings);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleArchive = async (p: Piece) => {
    setPieces((prev) => prev.map((x) => (x.id === p.id ? { ...x, archived: !p.archived } : x)));
    await api.from('pieces').update({ archived: !p.archived }).eq('id', p.id);
  };

  const remove = async (p: Piece) => {
    setToDelete(null);
    setPieces((prev) => prev.filter((x) => x.id !== p.id));
    await deletePiece(p.id);
  };

  if (loading) return <PageSpinner />;

  const creditNames = (p: Piece) =>
    credits
      .filter((c) => c.piece_id === p.id && c.name.trim())
      .map((c) => c.name)
      .join(' ');

  const filters = tf.bind<Piece>([
    {
      id: 'status',
      label: t('status'),
      options: [
        { value: 'active', label: t('active') },
        { value: 'archived', label: t('archived') },
      ],
      predicate: (p, v) => p.archived === (v === 'archived'),
    },
  ]);
  const query = tf.query.trim().toLowerCase();
  const visible = pieces.filter(
    (p) =>
      filters.every((f) => !f.value || f.predicate(p, f.value)) &&
      (!query || `${p.name} ${p.composer} ${p.description} ${creditNames(p)}`.toLowerCase().includes(query)),
  );

  return (
    <>
      <PageHeader
        title={t('pieceCollection')}
        subtitle={`${pieces.length} ${pieces.length === 1 ? t('pieceSingular') : t('pieces')}`}
        inlineActions
        actions={
          <>
            <TableFilterMenu query={tf.query} onQueryChange={tf.setQuery} filters={filters} />
            <HeaderAction icon={Plus} label={t('newPiece')} onClick={() => setFormOpen(true)} />
          </>
        }
      />

      {pieces.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-text-secondary">
            <Music size={22} />
          </span>
          <p className="font-medium">{t('noPiecesInCollection')}</p>
        </div>
      ) : visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-text-secondary">{t('noResults')}</p>
      ) : (
        <SortableList
          variant="joined"
          items={visible}
          getId={(p) => p.id}
          header={<PieceTableHeader actionsWidth={ACTIONS_WIDTH} />}
          renderItem={(p) => (
            <PieceTableRow
              piece={p}
              to={`/pieces/${p.id}`}
              hasRecordings={withRecordings.has(p.id)}
              badge={
                p.archived && (
                  <span className="flex-shrink-0 rounded-md border border-border px-1.5 py-0.5 text-xs text-text-tertiary">
                    {t('archived')}
                  </span>
                )
              }
              actionsWidth={ACTIONS_WIDTH}
              actions={
                <span className="flex items-center gap-1">
                  <RowActionButton label={p.archived ? t('unarchive') : t('archive')} onClick={() => void toggleArchive(p)}>
                    {p.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                  </RowActionButton>
                  <RowActionButton label={t('delete')} onClick={() => setToDelete(p)}>
                    <Trash2 size={15} />
                  </RowActionButton>
                </span>
              }
            />
          )}
        />
      )}

      <PieceForm
        open={formOpen}
        projectId={null}
        onClose={() => setFormOpen(false)}
        onCreated={(id) => navigate(`/pieces/${id}/setup`)}
      />

      <ConfirmDialog
        open={toDelete !== null}
        title={t('deletePiece')}
        message={t('confirmDeletePiece')}
        confirmLabel={t('delete')}
        destructive
        onConfirm={() => toDelete && void remove(toDelete)}
        onCancel={() => setToDelete(null)}
      />
    </>
  );
};
