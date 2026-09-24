import type { ReactNode } from 'react';
import { AppLogo } from '@/components/AppLogo';
import { FloatingPaths } from '@/components/FloatingPaths';
import { LegalFooter } from '@/components/LegalLinks';
import { config } from '@/lib/config';
import { cn } from '@/lib/cn';

// Frame of the sign-in screens (login, sign-up, 2FA setup): flowing lines and
// a soft accent glow behind a centered column with the brand mark on top and
// the legal links below. Put the content in <GlassPanel>s.
export const AuthShell = ({ children, wide }: { children: ReactNode; wide?: boolean }) => (
  <FloatingPaths className="flex min-h-full flex-col items-center justify-center bg-bg px-4 py-10 sm:px-6">
    <div
      aria-hidden
      className="pointer-events-none absolute -top-56 left-1/2 -z-10 h-[460px] w-[720px] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl"
    />
    <div className={cn('w-full animate-[authin_500ms_ease-out]', wide ? 'max-w-md' : 'max-w-[400px]')}>
      <div className="mb-8 flex items-center justify-center gap-2.5">
        <AppLogo className="h-6 w-6" />
        <span className="text-lg font-semibold">{config.appName}</span>
      </div>
      {children}
      <LegalFooter className="mt-8" />
    </div>
  </FloatingPaths>
);

// Frosted, rounded card. Inputs, buttons and choice tiles inside it pick up
// the rounded glass look (see .glass-panel in index.css).
export const GlassPanel = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('glass-panel rounded-3xl p-6 sm:p-8', className)}>{children}</div>
);

// Centered title and subtitle at the top of a panel.
export const AuthHeading = ({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) => (
  <div className="mb-6 text-center">
    <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
    {subtitle ? <p className="mt-1.5 text-sm text-text-secondary">{subtitle}</p> : null}
  </div>
);
