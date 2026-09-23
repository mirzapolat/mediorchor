import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import type { Piece } from '@/types';

interface PieceFormProps {
  open: boolean;
  projectId: string;
  piece: Piece | null; // null → create
  nextPosition: number; // position used for a newly created piece
  onClose: () => void;
  onSaved: () => void;
}

export const PieceForm = ({ open, projectId, piece, nextPosition, onClose, onSaved }: PieceFormProps) => {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [composer, setComposer] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(piece?.name ?? '');
    setComposer(piece?.composer ?? '');
  }, [open, piece]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setBusy(true);
    if (piece) {
      await api
        .from('pieces')
        .update({ name: trimmedName, composer: composer.trim() })
        .eq('id', piece.id);
    } else {
      await api.from('pieces').insert({
        project_id: projectId,
        name: trimmedName,
        composer: composer.trim(),
        position: nextPosition,
      });
    }
    setBusy(false);
    onClose();
    onSaved();
  };

  return (
    <Modal open={open} title={piece ? t('editPiece') : t('newPiece')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Input
          id="piece-name"
          label={t('pieceName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
        <Input
          id="piece-composer"
          label={t('composer')}
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            {piece ? t('save') : t('create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
