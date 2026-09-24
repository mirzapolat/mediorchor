import { Input, Select } from './Input';
import { useI18n } from '@/lib/i18n';
import { config } from '@/lib/config';
import type { RegistrationHeaderMode } from '@/types';

// What the public registration page shows at the top: the app's logo and
// name, the logo with a custom text, or nothing.
export const HeaderBrandingInput = ({
  mode,
  text,
  onChange,
}: {
  mode: RegistrationHeaderMode;
  text: string;
  onChange: (patch: { header_mode?: RegistrationHeaderMode; header_text?: string }) => void;
}) => {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Select
        label={t('registrationHeader')}
        value={mode}
        onChange={(e) => onChange({ header_mode: e.target.value as RegistrationHeaderMode })}
      >
        <option value="app">{t('registrationHeaderApp').replace('{name}', config.appName)}</option>
        <option value="custom">{t('registrationHeaderCustom')}</option>
        <option value="none">{t('registrationHeaderNone')}</option>
      </Select>
      {mode === 'custom' && (
        <Input
          label={t('registrationHeaderText')}
          value={text}
          maxLength={80}
          placeholder={config.appName}
          onChange={(e) => onChange({ header_text: e.target.value })}
        />
      )}
    </div>
  );
};
