import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface ToastState {
  id: number;
  text: string;
  undo?: () => Promise<void> | void;
}

// "Done" for a few seconds, with "Undo" when it can be — instead of asking
// first (the files page's black toast, for any page).
export const useToast = () => {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = useCallback((text: string, undo?: () => Promise<void> | void) => {
    window.clearTimeout(timer.current);
    const id = Date.now();
    setToast({ id, text, undo });
    timer.current = window.setTimeout(() => setToast((x) => (x?.id === id ? null : x)), 8000);
  }, []);
  const hide = useCallback(() => setToast(null), []);
  return { toast, show, hide };
};

export const Toast = ({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) => {
  const { t } = useI18n();
  if (!toast) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[60] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl bg-black py-2.5 pl-4 pr-2 text-sm text-white shadow-lg"
    >
      <span className="min-w-0 truncate">{toast.text}</span>
      {toast.undo && (
        <button
          type="button"
          onClick={() => {
            const undo = toast.undo;
            onClose();
            void undo?.();
          }}
          className="flex h-8 items-center gap-1.5 rounded-lg px-3 font-semibold text-accent hover:bg-white/10"
        >
          <RotateCcw size={14} />
          {t('undo')}
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label={t('close')}
        className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/10"
      >
        <X size={15} />
      </button>
    </div>
  );
};
