import { Input } from './Input';
import { Checkbox } from './RegistrationPageForm';
import { useI18n } from '@/lib/i18n';
import type { RegistrationSource } from '@/types';

// The page's extra field that only helps sorting out registrations: shown in
// the registrations list, dropped when transferring to members. `label` null
// = no such field.
export const NoteFieldInput = ({
  source,
  label,
  onChange,
}: {
  source: RegistrationSource;
  label: string | null;
  onChange: (label: string | null) => void;
}) => {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <Checkbox
        checked={label !== null}
        onChange={(on) => onChange(on ? '' : null)}
        label={t('noteField')}
        hint={source === 'webhook' ? t('noteFieldHintWebhook') : t('noteFieldHint')}
      />
      {label !== null && (
        <Input
          label={t('noteFieldLabel')}
          value={label}
          maxLength={80}
          placeholder={t('noteFieldPlaceholder')}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
};

// Value to store: null when off, else the label (a generic one when empty).
export const noteLabelToSave = (label: string | null, fallback: string) =>
  label === null ? null : label.trim() || fallback;
