import { useI18n } from '@/lib/i18n';
import type { AttendanceDisplayStatus } from '@/types';

const styles: Record<AttendanceDisplayStatus, string> = {
  attended: 'border-success text-success',
  excused: 'border-accent text-accent',
  not_attended: 'border-border text-text-tertiary',
  // Upcoming Proben: already marked present / nothing recorded yet.
  expected: 'border-success/50 bg-success-soft text-success-strong',
  upcoming: 'border-dashed border-border-strong text-text-secondary',
};

const labels = {
  attended: 'attended',
  excused: 'excused',
  not_attended: 'notAttended',
  expected: 'expectedStatus',
  upcoming: 'upcomingStatus',
} as const;

export const StatusBadge = ({ status }: { status: AttendanceDisplayStatus }) => {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-sm font-medium ${styles[status]}`}
    >
      {t(labels[status])}
    </span>
  );
};
