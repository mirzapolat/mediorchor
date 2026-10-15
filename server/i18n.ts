// Language of the emails the server sends. The languages are listed in
// shared/languages.ts; the texts live in server/locales.
import { FALLBACK_LANGUAGE, isLanguage, localeOf, toLanguage, type Language } from '../shared/languages.ts';
import { db } from './db.ts';
import { env } from './env.ts';
import de from './locales/de.ts';
import en, { type MailTexts } from './locales/en.ts';
import fi from './locales/fi.ts';

const MAIL_TEXTS: Record<Language, MailTexts> = { de, en, fi };

export const mailTexts = (lang: Language) => MAIL_TEXTS[lang];

export const defaultLanguage = () => toLanguage(env.client.VITE_DEFAULT_LANGUAGE);

// The language an account chose (Account → Language), or null.
export const accountLanguage = (userId: string | null | undefined): Language | null => {
  if (!userId) return null;
  const row = db.prepare('select language from app_users where id = ?').get(userId) as
    | { language: string | null }
    | undefined;
  return isLanguage(row?.language) ? row.language : null;
};

// Who gets which language: an account's own choice; without one (a public
// form, an account that never chose), the instance default and English below
// it, so everyone can read it.
export const mailLanguages = (lang: Language | null): Language[] =>
  lang ? [lang] : [...new Set([defaultLanguage(), FALLBACK_LANGUAGE])];

interface MailPart {
  subject: string;
  lines: string[];
}

// One email in one or more languages: the subjects joined with " / ", the
// bodies one after another, and an optional footer line per language.
export const composeMail = (
  langs: Language[],
  build: (texts: MailTexts, lang: Language) => MailPart,
  footer?: (texts: MailTexts) => string,
) => {
  const parts = langs.map((lang) => build(MAIL_TEXTS[lang], lang));
  const lines = parts.flatMap((part, i) => (i ? ['', ...part.lines] : part.lines));
  if (footer) lines.push('', '—', langs.map((lang) => footer(MAIL_TEXTS[lang])).join(' / '));
  return { subject: parts.map((p) => p.subject).join(' / '), text: lines.join('\n') };
};

// A Probe's date (a wall-clock YYYY-MM-DD) and optional time, e.g.
// "Montag, 6. Oktober, 19:00 Uhr".
export const formatWhen = (
  lang: Language,
  date: string | null,
  time: string | null,
  options: Intl.DateTimeFormatOptions,
) => {
  if (!date) return '';
  const day = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return '';
  const text = new Intl.DateTimeFormat(localeOf(lang), { ...options, timeZone: 'UTC' }).format(day);
  return time ? `${text}, ${MAIL_TEXTS[lang].time(time.slice(0, 5))}` : text;
};
