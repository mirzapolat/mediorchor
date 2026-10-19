import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AudioLines, ChevronRight, Mic, MicOff, Music, Plus, VolumeX, X, type LucideIcon } from 'lucide-react';
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
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import {
  loadPiecesOverview,
  persistOrder,
  removePieceFromProject,
  type PieceOverviewFile,
  type ProjectPieceItem,
} from '@/lib/pieceFiles';
import { formatTime, pieceDuration } from '@/lib/pieceTimeline';
import { useProjectContext } from '@/layouts/projectContext';
import { usePieceScope } from '@/layouts/pieceScope';

// Whether something is set up for a piece, at a glance: a green pill for
// yes, a grey one for no, each with its icon and the word.
const Availability = ({
  on,
  icon: Icon,
  offIcon: OffIcon,
  label,
  title,
}: {
  on: boolean;
  icon: LucideIcon;
  offIcon: LucideIcon;
  label: string;
  title: string;
}) => (
  <span
    title={title}
    aria-label={title}
    className={cn(
      'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium',
      on ? 'bg-success-soft text-success-strong' : 'bg-surface-muted text-text-tertiary',
    )}
  >
    {on ? <Icon size={14} /> : <OffIcon size={14} />}
    {label}
  </span>
);

// Column widths, shared by the header and the rows so they line up.
const COL = {
  composer: 'hidden w-48 flex-shrink-0 md:block lg:w-64',
  duration: 'hidden w-16 flex-shrink-0 sm:block',
  flag: 'hidden w-24 flex-shrink-0 sm:flex xl:w-28',
  chevron: 'w-[18px] flex-shrink-0',
  remove: 'w-10 flex-shrink-0',
};

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
              header={
                <div
                  className={cn(
                    'flex h-10 items-center gap-3 px-3 text-xs font-medium text-text-secondary sm:gap-4 sm:px-4',
                    // The rows' remove button sits outside their padded link.
                    canManage && 'pr-0 sm:pr-0',
                  )}
                >
                  <span className="min-w-0 flex-1">{t('columnTitle')}</span>
                  <span className={COL.composer}>{t('columnComposer')}</span>
                  <span className={cn(COL.duration, 'text-right')}>{t('columnDuration')}</span>
                  <span className={COL.flag}>{t('columnTraining')}</span>
                  <span className={COL.flag}>{t('columnTracks')}</span>
                  <span className={COL.chevron} />
                  {canManage && <span className={COL.remove} />}
                </div>
              }
              renderItem={(p) => {
                const duration = pieceDuration(p);
                const training = p.trainer_file_id != null;
                const tracks = withRecordings.has(p.id);
                return (
                  <div className="flex items-center">
                    <Link
                      to={`/projects/${project.id}/pieces/${p.id}`}
                      className="group flex min-h-[3.75rem] min-w-0 flex-1 items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-4"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.name}</span>
                        {/* Smaller screens: what has no column yet goes below the title. */}
                        <span className="flex min-w-0 items-center gap-2 text-sm text-text-secondary md:hidden">
                          {p.composer && <span className="truncate">{p.composer}</span>}
                          {duration != null && <span className="flex-shrink-0 tabular-nums sm:hidden">{formatTime(duration)}</span>}
                          <span className="flex flex-shrink-0 items-center gap-1 sm:hidden">
                            {training && <Mic size={13} className="text-success" aria-label={t('trainingAvailable')} />}
                            {tracks && <AudioLines size={13} className="text-success" aria-label={t('tracksAvailable')} />}
                          </span>
                        </span>
                      </span>
                      <span className={cn(COL.composer, 'truncate text-sm text-text-secondary')}>{p.composer || '—'}</span>
                      <span className={cn(COL.duration, 'text-right text-sm tabular-nums text-text-secondary')}>
                        {duration != null ? formatTime(duration) : '—'}
                      </span>
                      <span className={COL.flag}>
                        <Availability
                          on={training}
                          icon={Mic}
                          offIcon={MicOff}
                          label={training ? t('yes') : t('no')}
                          title={training ? t('trainingAvailable') : t('trainingUnavailable')}
                        />
                      </span>
                      <span className={COL.flag}>
                        <Availability
                          on={tracks}
                          icon={AudioLines}
                          offIcon={VolumeX}
                          label={tracks ? t('yes') : t('no')}
                          title={tracks ? t('tracksAvailable') : t('tracksUnavailable')}
                        />
                      </span>
                      <ChevronRight
                        size={18}
                        className={cn(
                          COL.chevron,
                          'text-text-tertiary transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-text-secondary',
                        )}
                      />
                    </Link>
                    {canManage && (
                      <span className={cn(COL.remove, 'flex justify-center')}>
                        <button
                          type="button"
                          onClick={() => setToRemove(p)}
                          aria-label={t('removeFromProject')}
                          title={t('removeFromProject')}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
                        >
                          <X size={15} />
                        </button>
                      </span>
                    )}
                  </div>
                );
              }}
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
