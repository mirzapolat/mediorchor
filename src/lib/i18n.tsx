import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isLanguage, type Language } from '@shared/languages';
import { DEFAULT_LANGUAGE } from './config';
import de from '@/locales/de';
import en, { type MessageKey, type Messages } from '@/locales/en';
import fi from '@/locales/fi';

// Minimal in-app i18n. The default language comes from VITE_DEFAULT_LANGUAGE but
// the user can switch at runtime; the choice is persisted to localStorage.
// The languages themselves are listed in shared/languages.ts.

const MESSAGES: Record<Language, Messages> = { de, en, fi };

export type TranslationKey = MessageKey;
interface I18nContextValue {
  lang: Language;
  setLang: (l: Language) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = 'anwesenheit.lang';

// A language that has since been removed counts as no choice.
const storedLanguage = (): Language | null => {
  const stored = localStorage.getItem(STORAGE_KEY);
  return isLanguage(stored) ? stored : null;
};

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [lang, setLangState] = useState<Language>(() => storedLanguage() ?? DEFAULT_LANGUAGE);

  // Screen readers, hyphenation and spell checking follow the page language.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<I18nContextValue>(() => {
    const messages = MESSAGES[lang];
    return {
      lang,
      setLang: (l: Language) => {
        setLangState(l);
        localStorage.setItem(STORAGE_KEY, l);
      },
      t: (key) => messages[key] ?? String(key),
    };
  }, [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
};
