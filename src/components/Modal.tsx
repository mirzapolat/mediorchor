import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Overlay } from './Overlay';
import { useI18n } from '@/lib/i18n';

type ModalSize = 'md' | 'lg' | 'xl' | '2xl' | '3xl';

const sizeClasses: Record<ModalSize, string> = {
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
};

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
}

export const Modal = ({ open, title, onClose, children, footer, size = 'md' }: ModalProps) => {
  const { t } = useI18n();
  if (!open) return null;

  return createPortal(
    <Overlay onClick={onClose}>
      <div
        className={`bg-white border border-border rounded-md w-full ${sizeClasses[size]} max-h-[90vh] flex flex-col mx-4 animate-[fadein_200ms_ease-in-out]`}
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
        <div className="overflow-y-auto px-5 py-4 space-y-4">{children}</div>
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
