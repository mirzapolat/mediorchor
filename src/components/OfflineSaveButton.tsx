import { useEffect, useRef, useState } from 'react';
import { CloudDownload, CloudOff, HardDriveDownload, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from './Button';
import { useI18n } from '@/lib/i18n';
import {
  getOfflineMeta,
  offlineSupported,
  removeProjectOffline,
  saveProjectOffline,
  type OfflineMeta,
} from '@/lib/offlinePieces';
import { cn } from '@/lib/cn';

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
      <Button
        variant="secondary"
        disabled={busy || (!online && !meta)}
        onClick={() => (meta ? setOpen((v) => !v) : void save())}
        aria-label={meta ? t('offlineSaved') : t('saveOffline')}
        title={meta ? `${t('offlineSaved')} · ${savedAt}` : t('saveOfflineHint')}
        className={cn('h-9 max-sm:w-9 max-sm:px-0', meta && !busy && 'text-success-strong')}
      >
        {busy ? (
          <Loader2 size={16} className="animate-spin" />
        ) : meta ? (
          <HardDriveDownload size={16} />
        ) : online ? (
          <CloudDownload size={16} />
        ) : (
          <CloudOff size={16} />
        )}
        <span className="hidden tabular-nums sm:inline">
          {busy
            ? progress.total > 0
              ? `${t('savingOffline')} ${progress.done}/${progress.total}`
              : t('savingOffline')
            : meta
              ? t('offlineSaved')
              : t('saveOffline')}
        </span>
      </Button>

      {/* Phones: progress under the icon-only button. */}
      {busy && progress.total > 0 && (
        <span className="absolute -bottom-4 right-0 whitespace-nowrap text-[10px] tabular-nums text-text-secondary sm:hidden">
          {progress.done}/{progress.total}
        </span>
      )}

      {error && (
        <p className="absolute right-0 top-full z-30 mt-2 w-64 rounded-lg border border-border bg-surface p-3 text-sm text-danger shadow-lg">
          {t('saveOfflineError')}
        </p>
      )}

      {open && meta && (
        <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border border-border bg-surface p-3 shadow-lg">
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
