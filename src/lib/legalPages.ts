import { useEffect, useState } from 'react';
import { api } from './api';
import type { TranslationKey } from './i18n';

// Imprint and privacy policy as public pages see them (see get_legal_pages).
export type LegalKind = 'imprint' | 'privacy';

export type LegalPage = { mode: 'none' } | { mode: 'text'; text: string } | { mode: 'link'; url: string };

export type LegalPages = Record<LegalKind, LegalPage>;

export const LEGAL_KINDS: LegalKind[] = ['imprint', 'privacy'];

// Public route of each page's own text, and its title.
export const LEGAL_PATH: Record<LegalKind, string> = { imprint: '/impressum', privacy: '/datenschutz' };
export const LEGAL_TITLE: Record<LegalKind, TranslationKey> = { imprint: 'imprint', privacy: 'privacyPolicy' };

const NONE: LegalPages = { imprint: { mode: 'none' }, privacy: { mode: 'none' } };

// Loaded once per page load and shared by every link; refreshLegalPages()
// after an admin changes them.
let cached: Promise<LegalPages> | null = null;

const load = () =>
  (cached ??= api
    .rpc('get_legal_pages')
    .then(({ data, error }) => (error || !data ? NONE : (data as LegalPages))));

export const refreshLegalPages = () => {
  cached = null;
  return load();
};

export const useLegalPages = () => {
  const [pages, setPages] = useState<LegalPages | null>(null);
  useEffect(() => {
    let cancelled = false;
    void load().then((value) => !cancelled && setPages(value));
    return () => {
      cancelled = true;
    };
  }, []);
  return pages;
};
