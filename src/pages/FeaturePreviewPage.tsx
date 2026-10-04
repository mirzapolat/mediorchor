import type { LucideIcon } from 'lucide-react';
import { Check, Construction } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { useI18n, type TranslationKey } from '@/lib/i18n';

// Placeholder for a planned section: says the feature doesn't exist yet and
// what it could do one day.
export const FeaturePreviewPage = ({
  title,
  icon: Icon,
  intro,
  ideas,
}: {
  title: TranslationKey;
  icon: LucideIcon;
  intro: TranslationKey;
  ideas: TranslationKey[];
}) => {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t(title)} />
      <div className="max-w-xl rounded-xl border border-dashed border-border px-6 py-10 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-surface-muted text-text-secondary">
            <Icon size={22} />
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-muted px-2 py-1 text-xs font-semibold text-text-secondary">
            <Construction size={13} />
            {t('notAvailableYet')}
          </span>
        </div>
        <p className="mt-4 font-medium">{t('featureNotImplemented')}</p>
        <p className="mt-1 text-sm text-text-secondary">{t(intro)}</p>
        <ul className="mt-4 space-y-2">
          {ideas.map((idea) => (
            <li key={idea} className="flex items-start gap-2 text-sm">
              <Check size={16} className="mt-0.5 flex-shrink-0 text-text-tertiary" />
              <span>{t(idea)}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
};
