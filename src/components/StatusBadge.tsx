import { useI18n } from '@/lib/i18n';
import type { AttendanceStatus } from '@/types';

const styles: Record<AttendanceStatus, string> = {
  attended: 'border-success text-success',
  excused: 'border-accent text-accent',
  not_attended: 'border-border text-text-tertiary',
};

export const StatusBadge = ({ status }: { status: AttendanceStatus }) => {
  const { t } = useI18n();
  const label = status === 'attended' ? t('attended') : status === 'excused' ? t('excused') : t('notAttended');
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-sm font-medium ${styles[status]}`}>
      {label}
    </span>
  );
};
