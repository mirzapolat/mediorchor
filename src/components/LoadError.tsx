import { useEffect, useState } from 'react';
import { RotateCw, TriangleAlert, WifiOff } from 'lucide-react';
import { Button } from '@/components/Button';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';

const STAFF = [64, 74, 84, 94, 104];

// A staff snapped in two, with a note drifting out of the gap. The same
// drawing is in public/offline.html (what the service worker shows when not
// even the app could load) — keep the two alike.
const SnappedStaff = ({ offline }: { offline: boolean }) => {
  const Badge = offline ? WifiOff : TriangleAlert;
  return (
    <div className="relative mx-auto h-40 w-60" aria-hidden>
      <svg viewBox="0 0 240 160" className="h-full w-full" fill="none" strokeLinecap="round">
        <circle cx="120" cy="88" r="70" className="fill-accent/10" />
        <g className="stroke-border-strong" strokeWidth="2">
          {STAFF.map((y) => (
            <path key={y} d={`M28 ${y}H100`} />
          ))}
        </g>
        <g className="stroke-border-strong" strokeWidth="2" transform="rotate(8 140 84)">
          {STAFF.map((y) => (
            <path key={y} d={`M140 ${y}H212`} />
          ))}
        </g>
        <g className="fill-text-secondary stroke-text-secondary" strokeWidth="2.5">
          <ellipse cx="58" cy="99" rx="7" ry="5" transform="rotate(-20 58 99)" stroke="none" />
          <path d="M64.5 97V62" />
          <ellipse cx="80" cy="89" rx="7" ry="5" transform="rotate(-20 80 89)" stroke="none" />
          <path d="M86.5 87V52" />
          <path d="M64.5 62L86.5 52" strokeWidth="5" />
        </g>
        <g className="fill-text-secondary stroke-text-secondary" strokeWidth="2.5" transform="rotate(8 140 84)">
          <ellipse cx="172" cy="79" rx="7" ry="5" transform="rotate(-20 172 79)" stroke="none" />
          <path d="M178.5 77V44" />
          <path d="M178.5 44C184 50 192 52 190 64" />
        </g>
        <g
          className="origin-center fill-accent stroke-accent [transform-box:fill-box] motion-safe:animate-[notefloat_3.2s_ease-in-out_infinite]"
          strokeWidth="2.5"
        >
          <ellipse cx="116" cy="132" rx="6" ry="4.5" transform="rotate(-20 116 132)" stroke="none" />
          <path d="M121.5 130V108" />
        </g>
      </svg>
      <div className="absolute left-1/2 top-1 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-surface shadow-sm">
        <Badge size={20} className={offline ? 'text-text-secondary' : 'text-danger'} />
      </div>
    </div>
  );
};

const useOnline = () => {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
};

interface LoadErrorProps {
  // The failure came from the network (a part of the app could not be
  // fetched): "no connection" while the device is offline.
  network: boolean;
  onRetry: () => void;
  // Fills the screen (nothing else of the app is shown).
  fullScreen?: boolean;
}

// Friendly page for when a page could not be loaded: offline, or something
// broke. Offline it retries by itself as soon as the connection is back.
export const LoadError = ({ network, onRetry, fullScreen }: LoadErrorProps) => {
  const { t } = useI18n();
  const online = useOnline();
  const offline = network && !online;
  const [wasOffline, setWasOffline] = useState(offline);

  useEffect(() => {
    if (offline) setWasOffline(true);
    else if (wasOffline) onRetry();
  }, [offline, wasOffline, onRetry]);

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center px-4 py-16 text-center animate-[authin_500ms_ease-out]',
        fullScreen ? 'min-h-full bg-bg' : 'h-full',
      )}
    >
      <SnappedStaff offline={network} />
      <h1 className="mt-6 text-xl font-semibold tracking-tight">
        {offline ? t('loadErrorOfflineTitle') : t('loadErrorTitle')}
      </h1>
      <p className="mt-1.5 max-w-sm text-sm text-text-secondary">
        {offline ? t('loadErrorOfflineText') : t('loadErrorText')}
      </p>
      <Button className="mt-6" onClick={onRetry}>
        <RotateCw size={16} />
        {t('loadErrorRetry')}
      </Button>
      {offline && (
        <p className="mt-3 flex items-center gap-2 text-xs text-text-tertiary">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-tertiary" />
          {t('loadErrorWaiting')}
        </p>
      )}
    </div>
  );
};
