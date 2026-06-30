import type { ReactNode } from 'react';

interface OverlayProps {
  onClick?: () => void;
  children: ReactNode;
}

// Shared semi-transparent, blurred backdrop. All modals and side panels render
// their backdrop through this so the styling lives in exactly one place.
export const Overlay = ({ onClick, children }: OverlayProps) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
    onClick={onClick}
  >
    {children}
  </div>
);
