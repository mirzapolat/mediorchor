// Centralised runtime configuration. Everything that should be customisable for
// a self-hosted deployment is read here, with sane defaults so `npm run dev`
// works out of the box.
//
// Resolution order for each value:
//   1. window.__APP_CONFIG__  — served by the app server as /config.js from its
//      environment (see server/index.ts),
//      so a single Docker image can be reconfigured without rebuilding.
//   2. import.meta.env.VITE_*  — baked in at build time / used by `npm run dev`.

export type Language = 'de' | 'en';

interface RuntimeConfig {
  VITE_DEFAULT_LANGUAGE?: string;
  VITE_APP_NAME?: string;
  VITE_ACCENT_COLOR?: string;
  // Set by the server from Admin Config → Branding (no build-time fallback).
  LOGO_URL?: string | null;
  LOGO_INVERT?: boolean;
}

const runtime: RuntimeConfig =
  (typeof window !== 'undefined' && (window as { __APP_CONFIG__?: RuntimeConfig }).__APP_CONFIG__) || {};

// Values starting with "__" are placeholders and count as "not provided".
const read = (key: 'VITE_DEFAULT_LANGUAGE' | 'VITE_APP_NAME' | 'VITE_ACCENT_COLOR'): string | undefined => {
  const fromRuntime = runtime[key];
  if (fromRuntime && !fromRuntime.startsWith('__')) return fromRuntime;
  const fromBuild = import.meta.env[key] as string | undefined;
  return fromBuild || undefined;
};

const rawLang = read('VITE_DEFAULT_LANGUAGE')?.toLowerCase();
export const DEFAULT_LANGUAGE: Language = rawLang === 'de' ? 'de' : 'en';

export const config = {
  defaultLanguage: DEFAULT_LANGUAGE,
  // Branding: the server merges Admin Config → Branding over the environment
  // into /config.js, so these already hold the effective values.
  appName: read('VITE_APP_NAME') ?? 'Anwesenheit',
  accentColor: read('VITE_ACCENT_COLOR') ?? '#efa100',
  // Uploaded logo (also the favicon); null = the bundled /favicon.svg.
  logoUrl: typeof runtime.LOGO_URL === 'string' && runtime.LOGO_URL ? runtime.LOGO_URL : null,
  // Flip the logo's lightness in dark mode (always for the bundled line art).
  logoInvert: runtime.LOGO_URL ? Boolean(runtime.LOGO_INVERT) : true,
};
