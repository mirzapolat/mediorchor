import { useEffect, useRef, useState } from 'react';
import { Check, CloudDownload, CloudOff, HardDriveDownload, RefreshCw, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { ActionCard } from './ActionCard';
import { useI18n } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import {
  getOfflineMeta,
  offlineSupported,
  removeProjectOffline,
  saveProjectOffline,
  type OfflineMeta,
} from '@/lib/offlinePieces';

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// Saves all of a project's pieces (data, scores, recordings) for use without
// a connection — one tap for everything. Once saved, it shows when, and
// offers to refresh or remove the offline copy.
export const OfflineSaveButton = ({ projectId }: { projectId: string }) => {
  const { t, lang } = useI18n();
  const [meta, setMeta] = useState<OfflineMeta | null>(() => getOfflineMeta(projectId));
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  if (!offlineSupported()) return null;

  const save = async () => {
    setOpen(false);
    setError(false);
    setProgress({ done: 0, total: 0 });
    try {
      setMeta(await saveProjectOffline(projectId, (done, total) => setProgress({ done, total })));
      track('offline-save');
    } catch {
      setError(true);
    }
    setProgress(null);
  };

  const remove = async () => {
    setOpen(false);
    await removeProjectOffline(projectId);
    setMeta(null);
  };

  const busy = progress !== null;
  const savedAt = meta
    ? new Date(meta.savedAt).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '';

  return (
    <div ref={ref} className="relative">
      <ActionCard
        icon={meta ? HardDriveDownload : online ? CloudDownload : CloudOff}
        title={meta ? t('offlineSaved') : t('saveOffline')}
        busy={busy}
        disabled={!online && !meta}
        onClick={() => (meta ? setOpen((v) => !v) : setConfirming(true))}
        hint={meta ? undefined : t('saveOfflineHint')}
        statusTone={error ? 'danger' : meta && !busy ? 'success' : 'muted'}
        status={
          error
            ? t('saveOfflineError')
            : busy
              ? progress.total > 0
                ? `${t('savingOffline')} ${progress.done}/${progress.total}`
                : t('savingOffline')
              : meta
                ? `${t('offlineSavedAt')} ${savedAt}`
                : t('saveOfflineShort')
        }
      />

      {/* What saving offline means, confirmed before anything is downloaded. */}
      <Modal
        open={confirming}
        title={t('saveOffline')}
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={() => {
                setConfirming(false);
                void save();
              }}
            >
              <CloudDownload size={16} />
              {t('saveOfflineConfirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">{t('saveOfflineIntro')}</p>
        <ul className="space-y-2 text-sm">
          {(['saveOfflinePoint1', 'saveOfflinePoint2', 'saveOfflinePoint3', 'saveOfflinePoint4', 'saveOfflinePoint5'] as const).map(
            (key) => (
              <li key={key} className="flex gap-2">
                <Check size={16} className="mt-0.5 flex-shrink-0 text-text-tertiary" />
                <span>{t(key)}</span>
              </li>
            ),
          )}
        </ul>
      </Modal>

      {open && meta && (
        <div className="absolute inset-x-0 top-full z-30 mt-2 rounded-xl border border-border bg-surface p-3 shadow-lg">
          <p className="text-sm font-medium">{t('offlineSaved')}</p>
          <p className="mt-1 text-xs text-text-secondary">
            {meta.pieces} {meta.pieces === 1 ? t('pieceSingular') : t('pieces')} · {meta.files} {t('filesCount')}
            {meta.bytes > 0 && ` · ${formatSize(meta.bytes)}`}
          </p>
          <p className="text-xs text-text-secondary">
            {t('offlineSavedAt')} {savedAt}
          </p>
          {meta.failed > 0 && (
            <p className="mt-1 text-xs text-danger">
              {t('offlineMissing').replace('{n}', String(meta.failed))}
            </p>
          )}
          <p className="mt-2 text-xs text-text-tertiary">{t('offlineRefreshHint')}</p>
          <div className="mt-3 flex gap-2">
            <Button className="h-8 flex-1 px-2 text-xs" onClick={() => void save()} disabled={!online}>
              <RefreshCw size={13} />
              {t('refreshOffline')}
            </Button>
            <Button variant="secondary" className="h-8 flex-1 px-2 text-xs" onClick={() => void remove()}>
              <Trash2 size={13} />
              {t('removeOffline')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
