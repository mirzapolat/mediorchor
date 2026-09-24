import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '@/lib/i18n';
import { LEGAL_KINDS, LEGAL_PATH, LEGAL_TITLE, useLegalPages, type LegalKind } from '@/lib/legalPages';
import { cn } from '@/lib/cn';

// Link to one legal page: its own text in the app, or the external page.
// Renders nothing while loading or when the page isn't set up.
export const LegalLink = ({ kind, className }: { kind: LegalKind; className?: string }) => {
  const { t } = useI18n();
  const page = useLegalPages()?.[kind];
  if (!page || page.mode === 'none') return null;
  return page.mode === 'link' ? (
    <a href={page.url} target="_blank" rel="noopener noreferrer" className={className}>
      {t(LEGAL_TITLE[kind])}
    </a>
  ) : (
    <Link to={LEGAL_PATH[kind]} className={className}>
      {t(LEGAL_TITLE[kind])}
    </Link>
  );
};

// Subtle centered footer ("Impressum · Datenschutz") for the bottom of public
// pages. Empty — and hidden — until an admin sets up at least one page
// (Admin → Configuration).
export const LegalFooter = ({ className }: { className?: string }) => {
  const { t } = useI18n();
  const pages = useLegalPages();
  const shown = LEGAL_KINDS.filter((kind) => pages && pages[kind].mode !== 'none');
  if (shown.length === 0) return null;
  return (
    <footer
      aria-label={t('legalNotices')}
      className={cn('flex items-center justify-center gap-2 text-xs text-text-tertiary', className)}
    >
      {shown.map((kind, index) => (
        <Fragment key={kind}>
          {index > 0 ? <span aria-hidden>·</span> : null}
          <LegalLink
            kind={kind}
            className="underline-offset-4 transition-colors hover:text-text-secondary hover:underline"
          />
        </Fragment>
      ))}
    </footer>
  );
};
