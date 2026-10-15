// The languages the app speaks, shared by the browser (src/) and the server.
//
// Adding a language:
//   1. Add it here (code, name in its own language, Intl locale).
//   2. Add src/locales/<code>.ts (copy en.ts and translate it) and register it
//      in src/lib/i18n.tsx.
//   3. Add server/locales/<code>.ts for the emails and register it in
//      server/i18n.ts.
//   4. Run `npm run lint`: TypeScript points at every remaining spot that
//      needs a translation (the Localized<…> records in src/lib).
// No migration is needed; accounts store the code and the server validates it
// against this list.

export const LANGUAGES = {
  de: { name: 'Deutsch', locale: 'de-DE' },
  en: { name: 'English', locale: 'en-GB' },
  fi: { name: 'Suomi', locale: 'fi-FI' },
} as const satisfies Record<string, { name: string; locale: string }>;

export type Language = keyof typeof LANGUAGES;

// Used when nothing (or something unknown) is configured.
export const FALLBACK_LANGUAGE: Language = 'en';

export const LANGUAGE_CODES = Object.keys(LANGUAGES) as Language[];

export const isLanguage = (value: unknown): value is Language =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(LANGUAGES, value);

// Parses a configured or stored value ("DE", " fi ", null, …).
export const toLanguage = (value: unknown, fallback: Language = FALLBACK_LANGUAGE): Language => {
  const code = typeof value === 'string' ? value.trim().toLowerCase() : value;
  return isLanguage(code) ? code : fallback;
};

// The Intl locale for dates and numbers.
export const localeOf = (lang: Language) => LANGUAGES[lang].locale;

// A text in every language; TypeScript flags any record missing one.
export type Localized<T = string> = Record<Language, T>;
