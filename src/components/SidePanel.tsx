import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Overlay } from './Overlay';
import { useI18n } from '@/lib/i18n';

interface SidePanelProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

// Right-hand slide-in panel. Always portalled to document.body so its fixed
// positioning is relative to the viewport, not a clipped overflow ancestor.
export const SidePanel = ({ open, title, onClose, children, footer }: SidePanelProps) => {
  const { t } = useI18n();
  if (!open) return null;

  return createPortal(
    <Overlay onClick={onClose}>
      <div
        className="fixed right-0 top-0 h-full w-full max-w-md bg-white border-l border-border flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label={t('close')}
            className="text-text-secondary hover:text-text transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-black rounded-md"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">{children}</div>
        {footer && (
          <div className="flex-shrink-0 flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
            {footer}
          </div>
        )}
      </div>
    </Overlay>,
    document.body,
  );
};
