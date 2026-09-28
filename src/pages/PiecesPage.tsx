import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, FileText, Headphones, Music, Plus, StickyNote, Timer } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { PageSpinner } from '@/components/Spinner';
import { Button } from '@/components/Button';
import { TableFilterMenu, useTableFilters } from '@/components/TableFilterMenu';
import { HeaderAction } from '@/components/HeaderAction';
import { SortableList } from '@/components/SortableList';
import { PieceForm } from '@/components/PieceForm';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { persistOrder } from '@/lib/pieceFiles';
import { formatTime, timelineDuration } from '@/lib/pieceTimeline';
import { useProjectContext } from '@/layouts/projectContext';
import { cn } from '@/lib/cn';
import type { Piece, PieceFileKind } from '@/types';

type Summary = { score: boolean; voices: string[] };

const MAX_VOICE_CHIPS = 4;

const Chip = ({ children, strong }: { children: React.ReactNode; strong?: boolean }) => (
  <span
    className={cn(
      'inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-medium',
      strong ? 'bg-black text-white' : 'bg-surface-muted text-text-secondary',
    )}
  >
    {children}
  </span>
);

// The project's pieces as a concert programme: running order numbers, title
// and composer, what is there to practise with (score, voices, exact bar
// timing, notes) and each piece's length, plus the programme's total length.
// Managers drag pieces into order.
export const PiecesPage = () => {
  const { t } = useI18n();
  const { project, canManage } = useProjectContext();
  const navigate = useNavigate();
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const tf = useTableFilters();
  const query = tf.query.trim().toLowerCase();

  const load = useCallback(async () => {
    const [pieceResult, fileResult] = await Promise.all([
      api.from('pieces').select('*').eq('project_id', project.id).order('position').order('created_at'),
      api
        .from('piece_files')
        .select('piece_id, kind, title, file_name, position, pieces!inner(project_id)')
        .eq('pieces.project_id', project.id)
        .order('position'),
    ]);
    const next: Record<string, Summary> = {};
    type Row = { piece_id: string; kind: PieceFileKind; title: string; file_name: string | null };
    for (const f of (fileResult.data as Row[] | null) ?? []) {
      const s = (next[f.piece_id] ??= { score: false, voices: [] });
      if (f.kind === 'score') s.score = true;
      if (f.kind === 'audio') s.voices.push(f.title || f.file_name || '—');
    }
    setPieces((pieceResult.data as Piece[] | null) ?? []);
    setSummaries(next);
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
    ? pieces.filter((p) => {
        const voices = summaries[p.id]?.voices.join(' ') ?? '';
        return `${p.name} ${p.composer} ${p.description} ${voices}`.toLowerCase().includes(query);
      })
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
      ) : visible.length === 0 ? (
        <p className="max-w-3xl py-12 text-center text-sm text-text-secondary">{t('noResults')}</p>
      ) : (
        <SortableList
          variant="joined"
          className="max-w-3xl"
          items={visible}
          getId={(p) => p.id}
          // Reordering a filtered subset would scramble positions.
          onReorder={canManage && !query ? reorder : undefined}
          renderItem={(p) => {
            const s = summaries[p.id];
            const voices = s?.voices ?? [];
            const duration = timelineDuration(p.timeline);
            const exact = p.timeline?.source === 'notation';
            const empty = !s?.score && voices.length === 0;
            const number = pieces.indexOf(p) + 1;
            return (
              <Link
                to={`/projects/${project.id}/pieces/${p.id}`}
                className="group flex items-start gap-3 py-4 pl-1 pr-3 sm:gap-5 sm:px-5"
              >
                {/* Running order in the programme (kept while searching). */}
                <span className="w-7 flex-shrink-0 pt-0.5 text-right text-xl font-semibold leading-none tabular-nums text-text-tertiary transition-colors duration-150 group-hover:text-text-secondary sm:w-10 sm:text-3xl">
                  {String(number).padStart(2, '0')}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-3">
                    <span className="min-w-0 flex-1 truncate text-base font-semibold sm:text-lg">{p.name}</span>
                    {duration != null && (
                      <span className="inline-flex flex-shrink-0 items-center gap-1 text-sm tabular-nums text-text-secondary">
                        <Timer size={13} className="text-text-tertiary" />
                        {formatTime(duration)}
                      </span>
                    )}
                  </span>
                  {(p.composer || p.description) && (
                    <span className="mt-0.5 block text-sm text-text-secondary">
                      {p.composer && <span className="italic">{p.composer}</span>}
                      {p.composer && p.description && ' · '}
                      {p.description}
                    </span>
                  )}

                  {empty ? (
                    canManage && (
                      <span className="mt-2.5 inline-flex h-6 items-center rounded-full border border-dashed border-border-strong px-2.5 text-xs font-medium text-text-secondary">
                        {t('notSetUpYet')}
                      </span>
                    )
                  ) : (
                    <span className="mt-2.5 flex flex-wrap gap-1.5">
                      {s?.score && (
                        <Chip>
                          <FileText size={12} />
                          {t('scoreTab')}
                        </Chip>
                      )}
                      {/* Phones: one compact count; wider screens: the voice names. */}
                      {voices.length > 0 && (
                        <span className="sm:hidden">
                          <Chip>
                            <Headphones size={12} />
                            {voices.length} {voices.length === 1 ? t('voiceSingular') : t('voices')}
                          </Chip>
                        </span>
                      )}
                      {voices.slice(0, MAX_VOICE_CHIPS).map((v, i) => (
                        <span key={`${v}-${i}`} className="hidden sm:inline-flex">
                          <Chip>{v}</Chip>
                        </span>
                      ))}
                      {voices.length > MAX_VOICE_CHIPS && (
                        <span className="hidden sm:inline-flex">
                          <Chip>+{voices.length - MAX_VOICE_CHIPS}</Chip>
                        </span>
                      )}
                      {exact && voices.length > 0 && <Chip strong>{t('exactBars')}</Chip>}
                      {p.notes.trim() && (
                        <Chip>
                          <StickyNote size={12} />
                          {t('notes')}
                        </Chip>
                      )}
                    </span>
                  )}
                </span>

                <ChevronRight
                  size={18}
                  className="mt-1 flex-shrink-0 text-text-tertiary transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-text-secondary"
                />
              </Link>
            );
          }}
        />
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
