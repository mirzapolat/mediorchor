import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, FileText, Headphones, Music, Plus, StickyNote } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { PageSpinner } from '@/components/Spinner';
import { EmptyState } from '@/components/EmptyState';
import { TableFilterMenu, useTableFilters } from '@/components/TableFilterMenu';
import { HeaderAction } from '@/components/HeaderAction';
import { SortableList } from '@/components/SortableList';
import { PieceForm } from '@/components/PieceForm';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { persistOrder } from '@/lib/pieceFiles';
import { useProjectContext } from '@/layouts/projectContext';
import type { Piece, PieceFileKind } from '@/types';

type Summary = { scores: number; tracks: number };

// The project's pieces in rehearsal order. Each card says at a glance what
// is there (score, voice tracks, notes); managers drag cards to reorder.
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
        .select('piece_id, kind, pieces!inner(project_id)')
        .eq('pieces.project_id', project.id),
    ]);
    const next: Record<string, Summary> = {};
    for (const f of (fileResult.data as Array<{ piece_id: string; kind: PieceFileKind }> | null) ?? []) {
      const s = (next[f.piece_id] ??= { scores: 0, tracks: 0 });
      if (f.kind === 'score') s.scores += 1;
      if (f.kind === 'audio') s.tracks += 1;
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
    ? pieces.filter((p) =>
        `${p.name} ${p.composer} ${p.description}`.toLowerCase().includes(query),
      )
    : pieces;

  return (
    <>
      <PageHeader
        title={t('pieces')}
        inlineActions
        actions={
          <>
            <TableFilterMenu query={tf.query} onQueryChange={tf.setQuery} />
            {canManage && <HeaderAction icon={Plus} label={t('newPiece')} onClick={() => setFormOpen(true)} />}
          </>
        }
      />

      {visible.length === 0 ? (
        <EmptyState icon={Music} message={query ? t('noResults') : t('noPieces')} />
      ) : (
        <SortableList
          className="max-w-3xl"
          items={visible}
          getId={(p) => p.id}
          // Reordering a filtered subset would scramble positions.
          onReorder={canManage && !query ? reorder : undefined}
          renderItem={(p, index) => {
            const s = summaries[p.id];
            return (
              <Link
                to={`/projects/${project.id}/pieces/${p.id}`}
                className="flex min-h-[4rem] items-center gap-3 rounded-r-md px-3 py-3 transition-colors duration-150 hover:bg-surface-subtle sm:px-4"
              >
                <span className="w-5 flex-shrink-0 text-right text-sm tabular-nums text-text-tertiary">
                  {query ? '' : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  {(p.composer || p.description) && (
                    <span className="mt-0.5 line-clamp-2 text-sm text-text-secondary">
                      {[p.composer, p.description].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
                <span className="flex flex-shrink-0 items-center gap-2.5 text-text-tertiary">
                  {s?.scores ? <FileText size={15} aria-label={t('fileKindScore')} /> : null}
                  {s?.tracks ? (
                    <span className="inline-flex items-center gap-1 text-xs tabular-nums" title={t('voicesTitle')}>
                      <Headphones size={15} />
                      {s.tracks}
                    </span>
                  ) : null}
                  {p.notes.trim() ? <StickyNote size={15} aria-label={t('notes')} /> : null}
                  <ChevronRight size={16} />
                </span>
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
