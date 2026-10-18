import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/Button';
import { PageSpinner } from '@/components/Spinner';
import { Credits } from '@/components/PieceDownloads';
import { CreditRow } from '@/components/CreditRow';
import { usePieceLayout } from '@/layouts/PieceLayout';
import { usePieceScope } from '@/layouts/pieceScope';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { loadPieceCredits } from '@/lib/pieceFiles';
import type { PieceCredit } from '@/types';

// A piece's "Credits": who worked on it (made the MIDIs, recorded, …).
// Everyone sees them; its editors add people with "+" (a name, or an
// account picked by searching), set what they did and remove them.
export const PieceCreditsPage = () => {
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
    <div className="max-w-2xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold sm:text-2xl">{t('credits')}</h1>
        {canEdit && (
          <Button onClick={() => void add()} aria-label={t('addCredit')} title={t('addCredit')}>
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
    </div>
  );
};
