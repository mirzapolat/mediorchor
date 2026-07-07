import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { PageSpinner } from '@/components/Spinner';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

// Instance-wide configuration (app_settings singleton).
export const AdminConfigPage = () => {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const [allowSelfSignup, setAllowSelfSignup] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('app_settings')
      .select('allow_self_signup')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        setAllowSelfSignup((data as { allow_self_signup: boolean } | null)?.allow_self_signup ?? true);
        setLoading(false);
      });
  }, []);

  if (!isAdmin) return <Navigate to="/" replace />;
  if (loading) return <PageSpinner />;

  const toggleSelfSignup = async () => {
    const next = !allowSelfSignup;
    setAllowSelfSignup(next);
    await supabase.from('app_settings').update({ allow_self_signup: next }).eq('id', 1);
  };

  return (
    <>
      <PageHeader title={t('configuration')} />

      <Card className="max-w-xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">{t('allowSelfSignup')}</p>
            <p className="text-sm text-text-secondary mt-0.5">{t('allowSelfSignupHint')}</p>
          </div>
          <label className="inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              className="h-4 w-4 accent-black"
              checked={allowSelfSignup}
              onChange={toggleSelfSignup}
            />
          </label>
        </div>
      </Card>
    </>
  );
};
