import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Input } from '@/components/Input';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { PageSpinner } from '@/components/Spinner';
import { Credits } from '@/components/PieceDownloads';
import { CreditRow } from '@/components/CreditRow';
import { usePieceLayout } from '@/layouts/PieceLayout';
import { usePieceScope } from '@/layouts/pieceScope';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Markdown } from '@/lib/markdown';
import { track } from '@/lib/analytics';
import { loadPieceCredits } from '@/lib/pieceFiles';
import type { PieceCredit } from '@/types';

// A piece's information: its short description (the line in the piece
// lists) and a formatted text. Everyone reads it; the piece's editors change
// both with "Edit". Members see nothing while both are empty.
const PieceInfo = () => {
  const { t } = useI18n();
  const { canEdit } = usePieceScope();
  const { piece, patchPiece } = usePieceLayout();
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shownDescription = piece.description.trim();
  const shownText = piece.notes.trim();
  const empty = !shownDescription && !shownText;
  if (empty && !canEdit) return null;

  const startEditing = () => {
    setDescription(piece.description);
    setText(piece.notes);
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const patch = { description: description.trim(), notes: text.trim() };
    const { error: saveError } = await api.from('pieces').update(patch).eq('id', piece.id);
    setBusy(false);
    if (saveError) return setError(`${t('saveFailed')} (${saveError.message})`);
    // The sidebar and the piece lists read the same piece.
    patchPiece(patch);
    setEditing(false);
    track('piece-info-saved');
  };

  if (editing) {
    return (
      <Card className="space-y-4 max-sm:p-4">
        <h2 className="text-base font-medium">{t('pieceInfo')}</h2>
        <Input
          id="piece-description"
          label={
            <>
              {t('shortDescription')} <span className="font-normal text-text-tertiary">({t('optional')})</span>
            </>
          }
          placeholder={t('shortDescriptionPlaceholder')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <MarkdownEditor
          id="piece-info"
          label={t('pieceInfoText')}
          hint={t('pieceInfoHint')}
          value={text}
          onChange={setText}
          minHeight={200}
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditing(false)} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 size={15} className="animate-spin" />}
            {t('save')}
          </Button>
        </div>
      </Card>
    );
  }

  if (empty) {
    return (
      <button
        type="button"
        onClick={startEditing}
        className="-ml-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-text-tertiary transition-colors duration-150 hover:bg-surface-muted hover:text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
      >
        <Plus size={14} />
        {t('addPieceInfo')}
      </button>
    );
  }

  return (
    <Card className="max-sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium">{t('pieceInfo')}</h2>
          {shownDescription && <p className="mt-0.5 text-sm text-text-secondary">{shownDescription}</p>}
        </div>
        {canEdit && (
          <Button variant="secondary" onClick={startEditing} className="h-8 flex-shrink-0 px-3">
            <Pencil size={14} />
            {t('edit')}
          </Button>
        )}
      </div>
      {shownText && <Markdown source={shownText} className="mt-3 space-y-2 break-words text-sm" />}
    </Card>
  );
};

// A piece's "Details": its information on top, below it who worked on it
// (made the MIDIs, recorded, …). Everyone sees them; its editors edit the
// information, add people with "+" (a name, or an account picked by
// searching), set what they did and remove them.
export const PieceDetailsPage = () => {
  const { t } = useI18n();
  const { canEdit } = usePieceScope();
  const { piece } = usePieceLayout();
  const [credits, setCredits] = useState<PieceCredit[] | null>(null);

  const load = useCallback(async () => setCredits(await loadPieceCredits(piece.id)), [piece.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const { data } = await api
      .from('piece_credits')
      .insert({ piece_id: piece.id, name: '', position: credits?.length ?? 0 })
      .select('*')
      .single();
    if (data) setCredits((cs) => [...(cs ?? []), data as PieceCredit]);
  };
  const update = async (credit: PieceCredit, patch: Partial<PieceCredit>) => {
    setCredits((cs) => cs?.map((c) => (c.id === credit.id ? { ...c, ...patch } : c)) ?? cs);
    await api.from('piece_credits').update(patch).eq('id', credit.id);
    // A linked account brings its photo (set by the database).
    if ('user_id' in patch) await load();
  };
  const remove = async (credit: PieceCredit) => {
    setCredits((cs) => cs?.filter((c) => c.id !== credit.id) ?? cs);
    await api.from('piece_credits').delete().eq('id', credit.id);
  };

  if (!credits) return <PageSpinner />;
  // Members see only who is named.
  const shown = canEdit ? credits : credits.filter((c) => c.name.trim());

  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-4">
        <h1 className="text-xl font-bold sm:text-2xl">{t('pieceDetailsPage')}</h1>
        <PieceInfo />
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t('credits')}</h2>
          {canEdit && (
            <Button variant="secondary" onClick={() => void add()} aria-label={t('addCredit')} title={t('addCredit')}>
              <Plus size={15} />
              <span className="hidden sm:inline">{t('addCredit')}</span>
            </Button>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-text-secondary">{t('noCredits')}</p>
        ) : canEdit ? (
          <ul className="space-y-3">
            {shown.map((c) => (
              <li key={c.id}>
                <CreditRow credit={c} onChange={(patch) => void update(c, patch)} onRemove={() => void remove(c)} />
              </li>
            ))}
          </ul>
        ) : (
          <Credits credits={shown} />
        )}
      </section>
    </div>
  );
};
