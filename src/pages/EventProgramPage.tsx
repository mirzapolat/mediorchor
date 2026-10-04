import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ListMusic, Plus, X } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { PageSpinner } from '@/components/Spinner';
import { Card } from '@/components/Card';
import { Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { HeaderAction } from '@/components/HeaderAction';
import { SortableList } from '@/components/SortableList';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { loadEventPrograms, type ProgramItem } from '@/lib/eventProgram';
import { loadPiecesOverview, persistOrder } from '@/lib/pieceFiles';
import { useEventContext } from '@/layouts/eventContext';
import type { Piece } from '@/types';

// The rehearsal's programme: pieces of the project (added on its Stücke page) in running
// order, each with what to prepare ("T. 1–30"), plus a general note. Members
// see it on "Meine Teilnahme"; during the rehearsal each row opens the piece.
export const EventProgramPage = () => {
  const { t } = useI18n();
  const { project, event, reloadEvent } = useEventContext();
  const [items, setItems] = useState<ProgramItem[]>([]);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  const load = useCallback(async () => {
    const [program, overview] = await Promise.all([
      loadEventPrograms([event.id]),
      // Only the project's own pieces can be assigned.
      loadPiecesOverview(project.id),
    ]);
    setItems(program);
    setPieces(overview.pieces);
    setLoading(false);
  }, [event.id, project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveProgramNote = async (value: string) => {
    const note = value.trim();
    if (note === (event.program_note ?? '')) return;
    await api.from('events').update({ program_note: note }).eq('id', event.id);
    setNoteSaved(true);
    reloadEvent();
  };

  const add = async (piece: Piece) => {
    await api.from('event_pieces').insert({ event_id: event.id, piece_id: piece.id, position: items.length });
    await load();
  };

  const remove = async (item: ProgramItem) => {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    await api.from('event_pieces').delete().eq('id', item.id);
  };

  const saveNote = async (item: ProgramItem, value: string) => {
    const note = value.trim();
    if (note === item.note) return;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, note } : i)));
    await api.from('event_pieces').update({ note }).eq('id', item.id);
  };

  const reorder = async (next: ProgramItem[]) => {
    setItems(next.map((item, i) => ({ ...item, position: i }))); // optimistic
    await persistOrder('event_pieces', next);
  };

  if (loading) return <PageSpinner />;

  const assigned = new Set(items.map((i) => i.piece_id));
  const available = pieces.filter((p) => !assigned.has(p.id));

  return (
    <>
      <PageHeader
        title={t('program')}
        subtitle={
          items.length > 0
            ? `${items.length} ${items.length === 1 ? t('pieceSingular') : t('pieces')}`
            : undefined
        }
        inlineActions
        actions={
          pieces.length > 0 && (
            <HeaderAction
              icon={Plus}
              label={t('addPieceToProgram')}
              onClick={() => setPickerOpen(true)}
              disabled={available.length === 0}
            />
          )
        }
      />

      <div className="max-w-3xl space-y-4">
        <Card className="max-sm:p-4">
          <Textarea
            label={t('programNote')}
            placeholder={t('programNotePlaceholder')}
            defaultValue={event.program_note ?? ''}
            rows={2}
            onChange={() => setNoteSaved(false)}
            onBlur={(e) => void saveProgramNote(e.target.value)}
          />
          <p className="mt-2 text-xs text-text-secondary">
            {noteSaved ? `✓ ${t('saved')}` : t('programHint')}
          </p>
        </Card>

        {pieces.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-text-secondary">
              <ListMusic size={22} />
            </span>
            <p className="max-w-sm text-sm text-text-secondary">{t('programNoPiecesInProject')}</p>
            <Link to={`/projects/${project.id}/pieces`} className="text-sm font-medium underline">
              {t('pieces')}
            </Link>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-text-secondary">
              <ListMusic size={22} />
            </span>
            <p className="font-medium">{t('programEmpty')}</p>
            <p className="max-w-sm text-sm text-text-secondary">{t('programEmptyHint')}</p>
            <Button onClick={() => setPickerOpen(true)} className="mt-2">
              <Plus size={16} />
              {t('addPieceToProgram')}
            </Button>
          </div>
        ) : (
          <SortableList
            variant="joined"
            items={items}
            getId={(i) => i.id}
            onReorder={reorder}
            renderItem={(item, index) => (
              <div className="flex flex-col gap-1.5 px-3 py-3 sm:px-4">
                <div className="flex items-center gap-3">
                  <Link
                    to={`/projects/${project.id}/pieces/${item.piece_id}`}
                    className="group flex min-w-0 flex-1 items-center gap-3"
                  >
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold tabular-nums text-text-secondary transition-colors duration-150 group-hover:bg-black group-hover:text-white">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.pieces?.name}</span>
                      {item.pieces?.composer && (
                        <span className="block truncate text-sm text-text-secondary">{item.pieces.composer}</span>
                      )}
                    </span>
                    <ChevronRight
                      size={18}
                      className="flex-shrink-0 text-text-tertiary transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-text-secondary"
                    />
                  </Link>
                  <button
                    type="button"
                    onClick={() => void remove(item)}
                    aria-label={t('removeFromProgram')}
                    title={t('removeFromProgram')}
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
                  >
                    <X size={15} />
                  </button>
                </div>
                <input
                  defaultValue={item.note}
                  placeholder={t('programPieceNotePlaceholder')}
                  aria-label={t('programPieceNote')}
                  onBlur={(e) => void saveNote(item, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2 text-base focus:border-black focus:outline-none sm:ml-11 sm:w-[calc(100%-2.75rem)] sm:text-sm"
                />
              </div>
            )}
          />
        )}
      </div>

      <Modal
        open={pickerOpen}
        title={t('addPieceToProgram')}
        onClose={() => setPickerOpen(false)}
        footer={
          <Button variant="secondary" onClick={() => setPickerOpen(false)}>
            {t('done')}
          </Button>
        }
      >
        {available.length === 0 ? (
          <p className="text-sm text-text-secondary">{t('programAllAssigned')}</p>
        ) : (
          <ul className="-my-2 divide-y divide-border">
            {available.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => void add(p)}
                  className="group flex w-full items-center gap-3 py-2.5 text-left"
                >
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold tabular-nums text-text-secondary transition-colors duration-150 group-hover:bg-black group-hover:text-white">
                    {pieces.indexOf(p) + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.name}</span>
                    {p.composer && <span className="block truncate text-sm text-text-secondary">{p.composer}</span>}
                  </span>
                  <Plus size={16} className="flex-shrink-0 text-text-tertiary group-hover:text-text" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
};
