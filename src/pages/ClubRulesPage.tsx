import { ScrollText } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { useI18n } from '@/lib/i18n';

export const ClubRulesPage = () => {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('rules')} />
      <EmptyState icon={ScrollText} message={t('comingSoon')} />
    </>
  );
};
