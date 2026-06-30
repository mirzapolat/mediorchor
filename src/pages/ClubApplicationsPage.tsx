import { FileText } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { useI18n } from '@/lib/i18n';

export const ClubApplicationsPage = () => {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('membershipApplications')} />
      <EmptyState icon={FileText} message={t('comingSoon')} />
    </>
  );
};
