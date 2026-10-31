import { useEffect, useState } from 'react';
import { Download, Share, SquarePlus } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useI18n } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import { canPromptInstall, isInstalled, isIos, promptInstall, subscribeInstall } from '@/lib/pwa';

// A nudge to install the app (mobile header, dashboard only): the browser's
// own prompt where there is one, otherwise the steps (iPhone/iPad) or a hint.
// Gone once the app runs installed.
export const InstallAppButton = () => {
  const { t } = useI18n();
  const [canPrompt, setCanPrompt] = useState(canPromptInstall);
  const [installed, setInstalled] = useState(isInstalled);
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(
    () =>
      subscribeInstall(() => {
        setCanPrompt(canPromptInstall());
        setInstalled(isInstalled());
      }),
    [],
  );
  if (installed) return null;

  const open = async () => {
    track('app-install-nudge', { kind: canPrompt ? 'prompt' : isIos() ? 'ios' : 'hint' });
    if (canPrompt) {
      if (await promptInstall()) setInstalled(true);
    } else {
      setHelpOpen(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void open()}
        className="nudge-pulse ml-1.5 inline-flex h-9 items-center gap-1.5 rounded-full bg-accent/10 px-3 text-xs font-semibold text-accent transition-colors hover:bg-accent/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Download size={14} className="flex-shrink-0" />
        {t('installAppShort')}
      </button>
      <Modal open={helpOpen} title={t('installApp')} onClose={() => setHelpOpen(false)}>
        {isIos() ? (
          <ol className="space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold">1</span>
              {t('installIosStep1')} <Share size={15} className="flex-shrink-0 text-text-secondary" />
            </li>
            <li className="flex items-center gap-2">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold">2</span>
              {t('installIosStep2')} <SquarePlus size={15} className="flex-shrink-0 text-text-secondary" />
            </li>
          </ol>
        ) : (
          <p className="text-sm text-text-secondary">{t('installAppBrowserHint')}</p>
        )}
      </Modal>
    </>
  );
};
