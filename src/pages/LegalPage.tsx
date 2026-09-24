import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { AppLogo } from '@/components/AppLogo';
import { Card } from '@/components/Card';
import { PageSpinner } from '@/components/Spinner';
import { LegalFooter } from '@/components/LegalLinks';
import { Markdown } from '@/lib/markdown';
import { useI18n } from '@/lib/i18n';
import { LEGAL_TITLE, useLegalPages, type LegalKind } from '@/lib/legalPages';
import { config } from '@/lib/config';

// Public imprint (/impressum) or privacy policy (/datenschutz), reachable
// without an account.
export const LegalPage = ({ kind }: { kind: LegalKind }) => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const pages = useLegalPages();

  if (!pages) return <PageSpinner />;
  const page = pages[kind];

  return (
    <main className="min-h-full px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-8 flex items-center justify-center gap-2 text-sm font-semibold text-text-secondary">
          <AppLogo className="h-6 w-6" />
          {config.appName}
        </header>
        <Card className="p-6 sm:p-8">
          <h1 className="mb-5 text-2xl font-bold tracking-tight">{t(LEGAL_TITLE[kind])}</h1>
          {page.mode === 'text' ? (
            <Markdown source={page.text} className="space-y-3 leading-relaxed text-text-secondary" />
          ) : page.mode === 'link' ? (
            <a
              href={page.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-medium underline underline-offset-4"
            >
              {t('openLegalPage')}
              <ExternalLink size={15} />
            </a>
          ) : (
            <p className="text-text-secondary">{t('legalPageMissing')}</p>
          )}
        </Card>
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          className="mx-auto mt-6 flex items-center gap-1.5 text-sm font-medium text-text-secondary transition-colors hover:text-text"
        >
          <ArrowLeft size={15} />
          {t('back')}
        </button>
        <LegalFooter className="mt-8" />
      </div>
    </main>
  );
};
