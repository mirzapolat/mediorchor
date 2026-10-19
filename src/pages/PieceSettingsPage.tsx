import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListMinus, Trash2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Input } from '@/components/Input';
import { NoAccess } from '@/components/NoAccess';
import { usePieceLayout } from '@/layouts/PieceLayout';
import { usePieceScope } from '@/layouts/pieceScope';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { deletePiece, removePieceFromProject } from '@/lib/pieceFiles';
import type { Piece } from '@/types';

// One thing that takes the piece away, with what it means and its button.
const DangerRow = ({ title, hint, action }: { title: string; hint: string; action: ReactNode }) => (
  <div className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
    <div className="min-w-0 flex-1 basis-64">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-0.5 text-sm text-text-secondary">{hint}</p>
    </div>
    {action}
  </div>
);

// A piece's "Einstellungen": its title and composer (side by side), and what
// takes it away — out of the project (it stays in the collection) or deleted
// for good. The files, bars and voices are wired on "Konfiguration"; the
// short description and information live on "Details".
export const PieceSettingsPage = () => {
  const { t } = useI18n();
  const { base, projectId, canEdit, canManageProject, canDelete } = usePieceScope();
  const { piece, patchPiece } = usePieceLayout();
  const navigate = useNavigate();
  const [removeOpen, setRemoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRemove = Boolean(projectId) && canManageProject;
  if (!canEdit && !canRemove && !canDelete) return <NoAccess />;

  const update = async (patch: Partial<Piece>) => {
    setError(null);
    // The sidebar shows the name and composer.
    patchPiece(patch);
    const { error: saveError } = await api.from('pieces').update(patch).eq('id', piece.id);
    if (saveError) setError(`${t('saveFailed')} (${saveError.message})`);
  };

  return (
    <div className="max-w-3xl space-y-6 pb-10">
      <h1 className="text-xl font-bold sm:text-2xl">{t('settings')}</h1>

      {canEdit && (
        <Card className="space-y-4 p-4 sm:p-5">
          <h2 className="font-semibold">{t('details')}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              id="piece-name"
              label={t('pieceName')}
              defaultValue={piece.name}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== piece.name) void update({ name: v });
                else e.target.value = piece.name;
              }}
            />
            <Input
              id="piece-composer"
              label={t('composer')}
              defaultValue={piece.composer}
              onBlur={(e) => e.target.value.trim() !== piece.composer && void update({ composer: e.target.value.trim() })}
            />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
        </Card>
      )}

      {(canRemove || canDelete) && (
        <Card className="space-y-3 border-danger/30 p-4 sm:p-5">
          <h2 className="font-semibold text-danger">{t('dangerZone')}</h2>
          <div className="divide-y divide-border">
            {canRemove && (
              <DangerRow
                title={t('removeFromProject')}
                hint={t('removeFromProjectHint')}
                action={
                  <Button variant="secondary" onClick={() => setRemoveOpen(true)}>
                    <ListMinus size={15} />
                    {t('removeFromProject')}
                  </Button>
                }
              />
            )}
            {canDelete && (
              <DangerRow
                title={t('deletePiece')}
                hint={t('deletePieceHint')}
                action={
                  <Button variant="secondary" onClick={() => setDeleteOpen(true)} className="text-danger">
                    <Trash2 size={15} />
                    {t('deletePiece')}
                  </Button>
                }
              />
            )}
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={deleteOpen}
        title={t('deletePiece')}
        message={t('confirmDeletePiece')}
        confirmLabel={t('delete')}
        destructive
        onConfirm={async () => {
          await deletePiece(piece.id);
          navigate(base);
        }}
        onCancel={() => setDeleteOpen(false)}
      />
      {projectId && (
        <ConfirmDialog
          open={removeOpen}
          title={t('removeFromProject')}
          message={t('confirmRemoveFromProject')}
          confirmLabel={t('removeFromProject')}
          onConfirm={async () => {
            await removePieceFromProject(projectId, piece.id);
            navigate(base);
          }}
          onCancel={() => setRemoveOpen(false)}
        />
      )}
    </div>
  );
};
