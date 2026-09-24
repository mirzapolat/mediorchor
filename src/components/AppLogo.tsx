import { cn } from '@/lib/cn';
import { config } from '@/lib/config';

// The app logo: the one uploaded in Admin Config → Branding, else the bundled
// public/favicon.svg. Always use this component. The app-logo class flips the
// logo for dark mode (src/index.css) — always for the bundled line art, for an
// uploaded logo only when the admin asked for it.
//
// `preview` shows a not-yet-saved choice instead (url null = bundled logo).
export const AppLogo = ({
  className,
  preview,
}: {
  className?: string;
  preview?: { url: string | null; invert: boolean };
}) => {
  const url = preview ? preview.url : config.logoUrl;
  const invert = url ? (preview ? preview.invert : config.logoInvert) : true;
  return <img src={url ?? '/favicon.svg'} alt="" className={cn(invert && 'app-logo', 'object-contain', className)} />;
};
