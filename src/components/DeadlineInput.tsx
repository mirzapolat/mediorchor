import { X } from 'lucide-react';
import { Input } from './Input';
import { useI18n } from '@/lib/i18n';
import { isPast, fromLocalInput } from '@/lib/registrationDeadline';

// Optional "registrations until" field of a registration form. `value` is the
// local "YYYY-MM-DDTHH:mm" of a datetime-local input ('' = no deadline).
export const DeadlineInput = ({ value, onChange }: { value: string; onChange: (value: string) => void }) => {
  const { t } = useI18n();
  const past = isPast(fromLocalInput(value));
  return (
    <div className="space-y-1.5">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1 sm:max-w-[260px]">
          <Input
            type="datetime-local"
            label={t('registrationDeadline')}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            title={t('removeDeadline')}
            aria-label={t('removeDeadline')}
            className="mb-1 rounded-md p-2 text-text-secondary transition-colors hover:bg-surface-muted hover:text-text"
          >
            <X size={16} />
          </button>
        )}
      </div>
      <p className={`text-sm ${past ? 'text-danger-strong' : 'text-text-secondary'}`}>
        {past ? t('registrationDeadlinePast') : t('registrationDeadlineHint')}
      </p>
    </div>
  );
};
