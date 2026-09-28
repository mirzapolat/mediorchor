import { useState } from 'react';
import { Archive, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import type { Project } from '@/types';

// Deleting a project is permanent, so the dialog first offers archiving (which
// keeps everything and can be undone). An already archived project only gets
// the plain confirmation.
export const DeleteProjectDialog = ({
  project,
  onClose,
  onArchived,
  onDeleted,
}: {
  project: Project | null;
  onClose: () => void;
  onArchived: () => void;
  onDeleted: () => void;
}) => {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  if (!project) return null;
  const archived = project.status === 'archived';

  const run = async (action: 'archive' | 'delete') => {
    setBusy(true);
    if (action === 'archive') {
      await api.from('projects').update({ status: 'archived' }).eq('id', project.id);
    } else {
      await api.from('projects').delete().eq('id', project.id);
    }
    setBusy(false);
    if (action === 'archive') onArchived();
    else onDeleted();
  };

  return (
    <Modal
      open
      size="lg"
      title={t('deleteProject')}
      onClose={onClose}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy} className="whitespace-nowrap">
            {t('cancel')}
          </Button>
          {!archived && (
            <Button variant="primary" onClick={() => void run('archive')} disabled={busy} className="whitespace-nowrap">
              <Archive size={15} />
              {t('archiveInstead')}
            </Button>
          )}
          <Button variant="accent" onClick={() => void run('delete')} disabled={busy} className="whitespace-nowrap">
            <Trash2 size={15} />
            {t('deletePermanently')}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-text-secondary">
        {t('deleteProjectWarning').replace('{name}', project.name)}
      </p>
      {!archived && <p className="text-sm text-text">{t('archiveInsteadHint')}</p>}
    </Modal>
  );
};
