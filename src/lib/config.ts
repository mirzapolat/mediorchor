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
}

const runtime: RuntimeConfig =
  (typeof window !== 'undefined' && (window as { __APP_CONFIG__?: RuntimeConfig }).__APP_CONFIG__) || {};

// Values starting with "__" are placeholders and count as "not provided".
const read = (key: keyof RuntimeConfig): string | undefined => {
  const fromRuntime = runtime[key];
  if (fromRuntime && !fromRuntime.startsWith('__')) return fromRuntime;
  const fromBuild = import.meta.env[key] as string | undefined;
  return fromBuild || undefined;
};

const rawLang = read('VITE_DEFAULT_LANGUAGE')?.toLowerCase();
export const DEFAULT_LANGUAGE: Language = rawLang === 'de' ? 'de' : 'en';

export const config = {
  defaultLanguage: DEFAULT_LANGUAGE,
  // Branding defaults; the owner can override these from the Settings page,
  // which persists to the `app_settings` table.
  appName: read('VITE_APP_NAME') ?? 'Anwesenheit',
  accentColor: read('VITE_ACCENT_COLOR') ?? '#efa100',
};
