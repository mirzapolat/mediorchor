import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Check, Share } from 'lucide-react';
import { Overlay } from './Overlay';
import { useI18n } from '@/lib/i18n';
import { clearPendingSave, pendingSave, sharePending, subscribePendingSave } from '@/lib/saveFile';

// The installed iPhone app: a file that was made (an export, a ZIP) after
// the tap that asked for it had expired waits here for one more tap, which
// opens the share sheet (see saveFile). Mounted once for the whole app.
export const SavePrompt = () => {
  const { t } = useI18n();
  const file = useSyncExternalStore(subscribePendingSave, pendingSave);
  if (!file) return null;
  return createPortal(
    <Overlay onClick={clearPendingSave}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="mx-4 w-full max-w-sm animate-[fadein_200ms_ease-in-out] rounded-2xl border border-border bg-surface p-5 shadow-lg"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-success-soft text-success-strong">
            <Check size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t('readyToShare')}</p>
            <p className="truncate text-sm text-text-tertiary" title={file.name}>
              {file.name}
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={clearPendingSave}
            className="h-10 rounded-lg px-4 text-sm font-medium text-text-secondary hover:bg-surface-muted hover:text-text"
          >
            {t('close')}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => void sharePending()}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-black px-4 text-sm font-semibold text-white hover:opacity-90"
          >
            <Share size={15} />
            {t('shareFile')}
          </button>
        </div>
      </div>
    </Overlay>,
    document.body,
  );
};
