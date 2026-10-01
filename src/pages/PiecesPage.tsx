import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Music, Plus } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { PageSpinner } from '@/components/Spinner';
import { Button } from '@/components/Button';
import { TableFilterMenu, useTableFilters } from '@/components/TableFilterMenu';
import { HeaderAction } from '@/components/HeaderAction';
import { SortableList } from '@/components/SortableList';
import { PieceForm } from '@/components/PieceForm';
import { OfflineSaveButton } from '@/components/OfflineSaveButton';
import { ScoresZipBanner } from '@/components/ScoresZipBanner';
import { useI18n } from '@/lib/i18n';
import { loadPiecesOverview, persistOrder, type PieceOverviewFile } from '@/lib/pieceFiles';
import { formatTime, timelineDuration } from '@/lib/pieceTimeline';
import { useProjectContext } from '@/layouts/projectContext';
import type { Piece } from '@/types';

// The project's pieces as a concert programme: running order number, title,
// composer and each piece's length, plus the programme's total length.
// Managers drag pieces into order. Downloads (all scores as ZIP, offline copy)
// sit in a narrow side column on wide screens and below the list on phones.
export const PiecesPage = () => {
  const { t } = useI18n();
  const { project, canManage } = useProjectContext();
  const navigate = useNavigate();
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [overviewFiles, setOverviewFiles] = useState<PieceOverviewFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const tf = useTableFilters();
  const query = tf.query.trim().toLowerCase();

  const load = useCallback(async () => {
    const overview = await loadPiecesOverview(project.id);
    setPieces(overview.pieces);
    setOverviewFiles(overview.files);
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const reorder = async (next: Piece[]) => {
    setPieces(next.map((p, i) => ({ ...p, position: i }))); // optimistic
    await persistOrder('pieces', next);
  };

  if (loading) return <PageSpinner />;

  const visible = query
    ? pieces.filter((p) => `${p.name} ${p.composer} ${p.description}`.toLowerCase().includes(query))
    : pieces;

  // Programme length from the pieces whose bar timing is known.
  const durations = pieces.map((p) => timelineDuration(p.timeline));
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
            {canManage && <HeaderAction icon={Plus} label={t('newPiece')} onClick={() => setFormOpen(true)} />}
          </>
        }
      />

      {pieces.length === 0 ? (
        <div className="flex max-w-3xl flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-text-secondary">
            <Music size={22} />
          </span>
          <p className="font-medium">{t('noPieces')}</p>
          <p className="max-w-sm text-sm text-text-secondary">
            {canManage ? t('noPiecesManagerHint') : t('noPiecesHint')}
          </p>
          {canManage && (
            <Button onClick={() => setFormOpen(true)} className="mt-2">
              <Plus size={16} />
              {t('newPiece')}
            </Button>
          )}
        </div>
      ) : (
        <div className="grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-start">
          {visible.length === 0 ? (
            <p className="py-12 text-center text-sm text-text-secondary">{t('noResults')}</p>
          ) : (
            <SortableList
              variant="joined"
              items={visible}
              getId={(p) => p.id}
              // Reordering a filtered subset would scramble positions.
              onReorder={canManage && !query ? reorder : undefined}
              renderItem={(p) => {
                const duration = timelineDuration(p.timeline);
                // Running order in the programme (kept while searching).
                const number = pieces.indexOf(p) + 1;
                return (
                  <Link
                    to={`/projects/${project.id}/pieces/${p.id}`}
                    className="group flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4"
                  >
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold tabular-nums text-text-secondary transition-colors duration-150 group-hover:bg-black group-hover:text-white">
                      {number}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.name}</span>
                      {p.composer && (
                        <span className="block truncate text-sm text-text-secondary">{p.composer}</span>
                      )}
                    </span>
                    {duration != null && (
                      <span className="flex-shrink-0 text-sm tabular-nums text-text-secondary">
                        {formatTime(duration)}
                      </span>
                    )}
                    <ChevronRight
                      size={18}
                      className="flex-shrink-0 text-text-tertiary transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-text-secondary"
                    />
                  </Link>
                );
              }}
            />
          )}

          <aside className="flex flex-col gap-3 lg:sticky lg:top-6">
            <ScoresZipBanner projectName={project.name} pieces={pieces} files={overviewFiles} />
            <OfflineSaveButton projectId={project.id} />
          </aside>
        </div>
      )}

      <PieceForm
        open={formOpen}
        projectId={project.id}
        nextPosition={pieces.length}
        onClose={() => setFormOpen(false)}
        onCreated={(id) => navigate(`/projects/${project.id}/pieces/${id}/setup`)}
      />
    </>
  );
};
