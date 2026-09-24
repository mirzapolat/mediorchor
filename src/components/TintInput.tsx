import { RotateCcw } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { config } from '@/lib/config';

// Background tint of the public registration page: a color, or null for the
// app's accent color.
export const TintInput = ({ value, onChange }: { value: string | null; onChange: (color: string | null) => void }) => {
  const { t } = useI18n();
  const shown = value ?? config.accentColor;
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-text">{t('registrationTint')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border py-1.5 pl-1.5 pr-3 transition-colors duration-150 hover:bg-surface-muted">
          <input
            type="color"
            value={shown}
            onChange={(e) => onChange(e.target.value.toLowerCase())}
            className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
          />
          <span className="font-mono text-sm uppercase">{shown}</span>
        </label>
        {value ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text"
          >
            <RotateCcw size={14} />
            {t('registrationTintReset')}
          </button>
        ) : (
          <span className="text-sm text-text-secondary">{t('registrationTintDefault')}</span>
        )}
      </div>
    </div>
  );
};
