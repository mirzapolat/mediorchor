import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';

interface PieceFormProps {
  open: boolean;
  projectId: string;
  nextPosition: number; // position used for the new piece
  onClose: () => void;
  onCreated: (pieceId: string) => void;
}

// Creates a piece; everything else (files, notes, timing) is set up on the
// piece's set-up page, which opens right after.
export const PieceForm = ({ open, projectId, nextPosition, onClose, onCreated }: PieceFormProps) => {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [composer, setComposer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setComposer('');
    setError(null);
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setBusy(true);
    const { data, error: dbError } = await api
      .from('pieces')
      .insert({
        project_id: projectId,
        name: trimmedName,
        composer: composer.trim(),
        position: nextPosition,
      })
      .select('id')
      .single();
    setBusy(false);
    if (dbError || !data) {
      setError(dbError?.message ?? t('error'));
      return;
    }
    onCreated((data as { id: string }).id);
  };

  return (
    <Modal open={open} title={t('newPiece')} onClose={onClose}>
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
        {error && <p className="text-sm text-accent">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            {t('createAndSetUp')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
