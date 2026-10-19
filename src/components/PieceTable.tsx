import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AudioLines, ChevronRight, Mic, MicOff, VolumeX, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { formatTime, pieceDuration } from '@/lib/pieceTimeline';
import type { Piece } from '@/types';

// Pieces as a table across the page — a project's programme and the whole
// collection look the same: title, composer, length, whether it can be
// practised with the trainer and whether its score plays with audio tracks.
// Rows go inside a joined SortableList (its `header` takes PieceTableHeader).

// Column widths, shared by the header and the rows so they line up.
const COL = {
  composer: 'hidden w-48 flex-shrink-0 md:block lg:w-64',
  duration: 'hidden w-16 flex-shrink-0 sm:block',
  flag: 'hidden w-24 flex-shrink-0 sm:flex xl:w-28',
  chevron: 'w-[18px] flex-shrink-0',
};

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

// `actionsWidth`: the width class of the rows' actions after the link (e.g.
// "w-10"), so the columns stay above their cells.
export const PieceTableHeader = ({ actionsWidth }: { actionsWidth?: string }) => {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        'flex h-10 items-center gap-3 px-3 text-xs font-medium text-text-secondary sm:gap-4 sm:px-4',
        // The rows' actions sit outside their padded link.
        actionsWidth && 'pr-0 sm:pr-0',
      )}
    >
      <span className="min-w-0 flex-1">{t('columnTitle')}</span>
      <span className={COL.composer}>{t('columnComposer')}</span>
      <span className={cn(COL.duration, 'text-right')}>{t('columnDuration')}</span>
      <span className={COL.flag}>{t('columnTraining')}</span>
      <span className={COL.flag}>{t('columnTracks')}</span>
      <span className={COL.chevron} />
      {actionsWidth && <span className={cn(actionsWidth, 'flex-shrink-0')} />}
    </div>
  );
};

export const PieceTableRow = ({
  piece,
  to,
  hasRecordings,
  badge,
  actions,
  actionsWidth,
}: {
  piece: Piece;
  to: string;
  hasRecordings: boolean;
  // Next to the title (e.g. "Archived").
  badge?: ReactNode;
  actions?: ReactNode;
  actionsWidth?: string;
}) => {
  const { t } = useI18n();
  const duration = pieceDuration(piece);
  const training = piece.trainer_file_id != null;
  return (
    <div className="flex items-center">
      <Link to={to} className="group flex min-h-[3.75rem] min-w-0 flex-1 items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-4">
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">{piece.name}</span>
            {badge}
          </span>
          {/* Smaller screens: what has no column yet goes below the title. */}
          <span className="flex min-w-0 items-center gap-2 text-sm text-text-secondary md:hidden">
            {piece.composer && <span className="truncate">{piece.composer}</span>}
            {duration != null && <span className="flex-shrink-0 tabular-nums sm:hidden">{formatTime(duration)}</span>}
            <span className="flex flex-shrink-0 items-center gap-1 sm:hidden">
              {training && <Mic size={13} className="text-success" aria-label={t('trainingAvailable')} />}
              {hasRecordings && <AudioLines size={13} className="text-success" aria-label={t('tracksAvailable')} />}
            </span>
          </span>
        </span>
        <span className={cn(COL.composer, 'truncate text-sm text-text-secondary')}>{piece.composer || '—'}</span>
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
            on={hasRecordings}
            icon={AudioLines}
            offIcon={VolumeX}
            label={hasRecordings ? t('yes') : t('no')}
            title={hasRecordings ? t('tracksAvailable') : t('tracksUnavailable')}
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
      {actions && <span className={cn(actionsWidth, 'flex flex-shrink-0 items-center justify-center')}>{actions}</span>}
    </div>
  );
};
