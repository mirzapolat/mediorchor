import { useI18n } from '@/lib/i18n';
import { Card } from '@/components/Card';

export const NotConfiguredPage = () => {
  const { t } = useI18n();
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Card className="max-w-lg">
        <h1 className="text-xl font-semibold mb-2">{t('appName')}</h1>
        <p className="text-text-secondary text-sm mb-4">{t('notConfigured')}</p>
        <pre className="bg-[#f5f5f5] border border-border rounded-md p-3 text-sm overflow-x-auto">
{`VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key`}
        </pre>
      </Card>
    </div>
  );
};
