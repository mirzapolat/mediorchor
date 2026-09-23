import { cn } from '@/lib/cn';

// The app logo (public/favicon.svg). Always use this component: the app-logo
// class adapts the logo to dark mode (src/index.css).
export const AppLogo = ({ className }: { className?: string }) => (
  <img src="/favicon.svg" alt="" className={cn('app-logo', className)} />
);
