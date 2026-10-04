import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, ArchiveRestore, Music, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { PageSpinner } from '@/components/Spinner';
import { Avatar } from '@/components/Avatar';
import { DataTable, type Column } from '@/components/DataTable';
import { RowActionButton } from '@/components/RowActionButton';
import { TableFilterMenu, useTableFilters } from '@/components/TableFilterMenu';
import { HeaderAction } from '@/components/HeaderAction';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PieceForm } from '@/components/PieceForm';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { deletePiece } from '@/lib/pieceFiles';
import { formatTime, timelineDuration } from '@/lib/pieceTimeline';
import type { Piece } from '@/types';

// The collection of all pieces, shared by every project (dashboard tab
// "Stücke", admins and the 'all' pieces permission): create, edit, archive
// and delete pieces here; projects pick theirs from it.
export const GlobalPiecesPage = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Piece | null>(null);
  const tf = useTableFilters({ status: 'active' });

  const load = useCallback(async () => {
    const { data } = await api.from('pieces').select('*').order('name');
    setPieces((data as Piece[] | null) ?? []);
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

  const columns: Column<Piece>[] = [
    {
      id: 'name',
      header: t('pieceName'),
      accessor: (p) => p.name,
      render: (p) => (
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-medium">{p.name}</span>
          {p.archived && (
            <span className="rounded-md border border-border px-1.5 py-0.5 text-xs text-text-tertiary">
              {t('archived')}
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'composer',
      header: t('composer'),
      accessor: (p) => p.composer,
      render: (p) => p.composer || <span className="text-text-tertiary">—</span>,
    },
    {
      id: 'description',
      header: t('description'),
      accessor: (p) => p.description,
      mobile: 'hidden',
      render: (p) =>
        p.description ? (
          <span className="line-clamp-1 text-sm text-text-secondary">{p.description}</span>
        ) : (
          <span className="text-text-tertiary">—</span>
        ),
    },
    {
      id: 'length',
      header: t('pieceLength'),
      accessor: (p) => timelineDuration(p.timeline),
      className: 'w-px whitespace-nowrap tabular-nums',
      render: (p) => {
        const d = timelineDuration(p.timeline);
        return d != null ? formatTime(d) : <span className="text-text-tertiary">—</span>;
      },
    },
    {
      id: 'credits',
      header: t('credits'),
      accessor: (p) => p.midi_credit_name,
      mobile: 'hidden',
      render: (p) =>
        p.midi_credit_name ? (
          <span className="inline-flex min-w-0 items-center gap-2">
            <Avatar name={p.midi_credit_name} photoUrl={p.midi_credit_photo_url} size={22} />
            <span className="truncate text-sm">{p.midi_credit_name}</span>
          </span>
        ) : (
          <span className="text-text-tertiary">—</span>
        ),
    },
  ];

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

      <DataTable
        rows={pieces}
        columns={columns}
        getRowId={(p) => p.id}
        onRowClick={(p) => navigate(`/pieces/${p.id}`)}
        search={(p) => `${p.name} ${p.composer} ${p.description} ${p.midi_credit_name}`}
        filters={filters}
        query={tf.query}
        hideToolbar
        emptyMessage={t('noPiecesInCollection')}
        emptyIcon={Music}
        actions={(p) => (
          <>
            <RowActionButton label={t('edit')} onClick={() => navigate(`/pieces/${p.id}/setup`)}>
              <Pencil size={15} />
            </RowActionButton>
            <RowActionButton label={p.archived ? t('unarchive') : t('archive')} onClick={() => void toggleArchive(p)}>
              {p.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
            </RowActionButton>
            <RowActionButton label={t('delete')} onClick={() => setToDelete(p)}>
              <Trash2 size={15} />
            </RowActionButton>
          </>
        )}
      />

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
