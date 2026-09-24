import { useState } from 'react';
import { ImagePlus, Upload, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { uploadImage } from '@/lib/uploadImage';

// Optional cover image of a public registration form. Uploads right away;
// the URL is saved with the rest of the form.
export const CoverInput = ({ value, onChange }: { value: string | null; onChange: (url: string | null) => void }) => {
  const { t } = useI18n();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    const { url, error: uploadError } = await uploadImage('registrations', file);
    setUploading(false);
    if (uploadError) setError(uploadError);
    else onChange(url);
  };

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-text">{t('registrationCover')}</p>
      <div className="flex items-center gap-4">
        {value ? (
          <img src={value} alt="" className="h-20 w-20 flex-shrink-0 rounded-lg border border-border object-cover" />
        ) : (
          <span className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-lg border border-dashed border-border-strong text-text-tertiary">
            <ImagePlus size={22} />
          </span>
        )}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-text-secondary transition-colors duration-150 hover:bg-surface-muted">
              <Upload size={15} />
              {uploading ? t('loading') : value ? t('replaceImage') : t('uploadImage')}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void upload(file);
                }}
              />
            </label>
            {value && (
              <button
                type="button"
                onClick={() => onChange(null)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text"
              >
                <X size={15} />
                {t('remove')}
              </button>
            )}
          </div>
          <p className="text-sm text-text-secondary">{t('registrationCoverHint')}</p>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-danger-strong">{error}</p>}
    </div>
  );
};
