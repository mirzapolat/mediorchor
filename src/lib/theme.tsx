import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

// Light / dark / follow the operating system. The choice is per device
// (localStorage), so it also applies on the login and public pages.
//
// The active theme lives on <html data-theme="light|dark">; all colors are
// tokens that switch on it (src/index.css). The inline script in index.html
// applies the stored choice before first paint using the same key and rules —
// keep the two in sync.
export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_KEY = 'anwesenheit.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

const readPreference = (): ThemePreference => {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
};

const systemTheme = (): ResolvedTheme => (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light');

const applyTheme = (theme: ResolvedTheme) => {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  // Browser UI (mobile address bar) matches the page background.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', getComputedStyle(root).getPropertyValue('--color-bg').trim() || '');
};

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);
  const resolved = preference === 'system' ? system : preference;

  // Follow OS changes live while on "system".
  useEffect(() => {
    const mql = window.matchMedia(DARK_QUERY);
    const onChange = () => setSystem(mql.matches ? 'dark' : 'light');
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  // Keep other tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY) setPreferenceState(readPreference());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => applyTheme(resolved), [resolved]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolved,
      setPreference: (next) => {
        try {
          if (next === 'system') localStorage.removeItem(THEME_KEY);
          else localStorage.setItem(THEME_KEY, next);
        } catch {
          // Storage unavailable (private mode): the choice lasts for this visit.
        }
        setPreferenceState(next);
      },
    }),
    [preference, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
};
