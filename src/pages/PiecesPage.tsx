import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Music, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageSpinner } from '@/components/Spinner';
import { DataTable, type Column } from '@/components/DataTable';
import { RowActionButton } from '@/components/RowActionButton';
import { PieceForm } from '@/components/PieceForm';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { removePieceFiles } from '@/lib/pieceFiles';
import { useProjectContext } from '@/layouts/projectContext';
import type { Piece } from '@/types';

export const PiecesPage = () => {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const navigate = useNavigate();
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Piece | null>(null);
  const [toDelete, setToDelete] = useState<Piece | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('pieces')
      .select('*')
      .eq('project_id', project.id)
      .order('position')
      .order('created_at');
    setPieces((data as Piece[] | null) ?? []);
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const reorder = async (next: Piece[]) => {
    setPieces(next); // optimistic — the drop already happened visually
    await Promise.all(
      next.map((piece, index) =>
        piece.position === index
          ? null
          : supabase.from('pieces').update({ position: index }).eq('id', piece.id),
      ),
    );
    await load();
  };

  const remove = async () => {
    if (!toDelete) return;
    // Blocks cascade in the database; storage attachments need manual cleanup.
    const { data } = await supabase
      .from('piece_blocks')
      .select('file_path, score_path')
      .eq('piece_id', toDelete.id);
    const paths = (
      (data as Array<{ file_path: string | null; score_path: string | null }> | null) ?? []
    ).flatMap((b) => [b.file_path, b.score_path].filter((p): p is string => !!p));
    await supabase.from('pieces').delete().eq('id', toDelete.id);
    void removePieceFiles(paths);
    setToDelete(null);
    await load();
  };

  if (loading) return <PageSpinner />;

  const columns: Column<Piece>[] = [
    {
      id: 'name',
      header: t('name'),
      render: (p) => <span className="font-medium">{p.name}</span>,
    },
    {
      id: 'composer',
      header: t('composer'),
      render: (p) => <span className="text-text-secondary">{p.composer || '—'}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('pieces')}
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus size={16} />
            {t('newPiece')}
          </Button>
        }
      />

      <DataTable
        rows={pieces}
        columns={columns}
        getRowId={(p) => p.id}
        onRowClick={(p) => navigate(`/projects/${project.id}/pieces/${p.id}`)}
        onReorder={reorder}
        emptyMessage={t('noPieces')}
        emptyIcon={Music}
        actions={(p) => (
          <>
            <RowActionButton
              label={t('edit')}
              onClick={() => {
                setEditing(p);
                setFormOpen(true);
              }}
            >
              <Pencil size={15} />
            </RowActionButton>
            <RowActionButton label={t('delete')} onClick={() => setToDelete(p)}>
              <Trash2 size={15} />
            </RowActionButton>
          </>
        )}
      />

      <PieceForm
        open={formOpen}
        projectId={project.id}
        piece={editing}
        nextPosition={pieces.length}
        onClose={() => setFormOpen(false)}
        onSaved={load}
      />

      <ConfirmDialog
        open={!!toDelete}
        title={t('delete')}
        message={t('confirmDeletePiece')}
        confirmLabel={t('delete')}
        destructive
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </>
  );
};
