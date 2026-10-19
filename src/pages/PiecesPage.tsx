import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Music, Plus, X } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { PageSpinner } from '@/components/Spinner';
import { Button } from '@/components/Button';
import { TableFilterMenu, useTableFilters } from '@/components/TableFilterMenu';
import { HeaderAction } from '@/components/HeaderAction';
import { SortableList } from '@/components/SortableList';
import { PieceForm } from '@/components/PieceForm';
import { AddPieceModal } from '@/components/AddPieceModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ScoresZipButton } from '@/components/ScoresZipBanner';
import { PieceTableHeader, PieceTableRow } from '@/components/PieceTable';
import { useI18n } from '@/lib/i18n';
import {
  loadPiecesOverview,
  persistOrder,
  removePieceFromProject,
  type PieceOverviewFile,
  type ProjectPieceItem,
} from '@/lib/pieceFiles';
import { pieceDuration } from '@/lib/pieceTimeline';
import { useProjectContext } from '@/layouts/projectContext';
import { usePieceScope } from '@/layouts/pieceScope';

// The project's pieces as a concert programme, a table across the page:
// title, composer, length, whether it can be practised with
// the trainer and whether its score plays with audio tracks — plus the
// programme's total length. The pieces come from the shared collection:
// managers add them (or, with the pieces permission, create new ones), take
// them out again and drag them into order. All scores download as one ZIP
// from the header.
export const PiecesPage = () => {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const { canEdit, canManageProject: canManage } = usePieceScope();
  // New pieces: the project's managers with the pieces permission.
  const canCreate = canManage && canEdit;
  const navigate = useNavigate();
  const [pieces, setPieces] = useState<ProjectPieceItem[]>([]);
  const [overviewFiles, setOverviewFiles] = useState<PieceOverviewFile[]>([]);
  const [withRecordings, setWithRecordings] = useState<Set<string>>(new Set());
  const [zipStatus, setZipStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [toRemove, setToRemove] = useState<ProjectPieceItem | null>(null);
  const tf = useTableFilters();
  const query = tf.query.trim().toLowerCase();

  const load = useCallback(async () => {
    const overview = await loadPiecesOverview(project.id);
    setPieces(overview.pieces);
    setOverviewFiles(overview.files);
    setWithRecordings(overview.withRecordings);
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const reorder = async (next: ProjectPieceItem[]) => {
    setPieces(next.map((p, i) => ({ ...p, link: { ...p.link, position: i } }))); // optimistic
    await persistOrder(
      'project_pieces',
      next.map((p) => p.link),
    );
  };

  const remove = async (piece: ProjectPieceItem) => {
    setToRemove(null);
    setPieces((prev) => prev.filter((p) => p.id !== piece.id));
    await removePieceFromProject(project.id, piece.id);
    await load();
  };

  if (loading) return <PageSpinner />;

  const visible = query
    ? pieces.filter((p) => `${p.name} ${p.composer} ${p.description}`.toLowerCase().includes(query))
    : pieces;

  // Programme length from the pieces whose bar timing is known.
  const durations = pieces.map((p) => pieceDuration(p));
  const known = durations.filter((d): d is number => d != null);
  const total = known.reduce((a, b) => a + b, 0);
  const subtitle =
    pieces.length === 0
      ? undefined
      : [
          `${pieces.length} ${pieces.length === 1 ? t('pieceSingular') : t('pieces')}`,
          known.length > 0
            ? `${known.length < pieces.length ? t('atLeast') + ' ' : ''}${Math.round(total / 60)} ${t('minutesShort')}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <>
      <PageHeader
        title={t('pieces')}
        subtitle={subtitle}
        inlineActions
        actions={
          <>
            <TableFilterMenu query={tf.query} onQueryChange={tf.setQuery} />
            <ScoresZipButton projectName={project.name} pieces={pieces} files={overviewFiles} onStatus={setZipStatus} />
            {canManage && <HeaderAction icon={Plus} label={t('addPiece')} onClick={() => setAddOpen(true)} />}
          </>
        }
      />

      {pieces.length === 0 ? (
        <div className="flex max-w-3xl flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-text-secondary">
            <Music size={22} />
          </span>
          <p className="font-medium">{t('noPieces')}</p>
          <p className="max-w-sm text-sm text-text-secondary">
            {canManage ? t('noPiecesManagerHint') : t('noPiecesHint')}
          </p>
          {canManage && (
            <Button onClick={() => setAddOpen(true)} className="mt-2">
              <Plus size={16} />
              {t('addPiece')}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {zipStatus && (
            <p role="alert" className="flex items-center gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
              <span className="min-w-0 flex-1">{zipStatus.text}</span>
              <button
                type="button"
                onClick={() => setZipStatus(null)}
                aria-label={t('close')}
                className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-hover"
              >
                <X size={14} />
              </button>
            </p>
          )}
          {visible.length === 0 ? (
            <p className="py-12 text-center text-sm text-text-secondary">{t('noResults')}</p>
          ) : (
            <SortableList
              variant="joined"
              items={visible}
              getId={(p) => p.id}
              // Reordering a filtered subset would scramble positions.
              onReorder={canManage && !query ? reorder : undefined}
              header={<PieceTableHeader actionsWidth={canManage ? 'w-10' : undefined} />}
              renderItem={(p) => (
                <PieceTableRow
                  piece={p}
                  to={`/projects/${project.id}/pieces/${p.id}`}
                  hasRecordings={withRecordings.has(p.id)}
                  actionsWidth="w-10"
                  actions={
                    canManage && (
                      <button
                        type="button"
                        onClick={() => setToRemove(p)}
                        aria-label={t('removeFromProject')}
                        title={t('removeFromProject')}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
                      >
                        <X size={15} />
                      </button>
                    )
                  }
                />
              )}
            />
          )}
        </div>
      )}

      <AddPieceModal
        open={addOpen}
        projectId={project.id}
        nextPosition={pieces.length}
        onClose={() => setAddOpen(false)}
        onAdded={() => void load()}
        onCreateNew={
          canCreate
            ? () => {
                setAddOpen(false);
                setFormOpen(true);
              }
            : undefined
        }
      />

      <PieceForm
        open={formOpen}
        projectId={project.id}
        onClose={() => setFormOpen(false)}
        onCreated={(id) => navigate(`/projects/${project.id}/pieces/${id}/setup`)}
      />

      <ConfirmDialog
        open={toRemove !== null}
        title={t('removeFromProject')}
        message={t('confirmRemoveFromProject')}
        confirmLabel={t('removeFromProject')}
        onConfirm={() => toRemove && void remove(toRemove)}
        onCancel={() => setToRemove(null)}
      />
    </>
  );
};
