import { Modal } from './Modal';
import { Button } from './Button';
import { useI18n } from '@/lib/i18n';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog = ({
  open,
  title,
  message,
  confirmLabel,
  destructive,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
  const { t } = useI18n();
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button variant={destructive ? 'accent' : 'primary'} onClick={onConfirm}>
            {confirmLabel ?? t('confirm')}
          </Button>
        </>
      }
    >
      <p className="text-text-secondary text-sm">{message}</p>
    </Modal>
  );
};
