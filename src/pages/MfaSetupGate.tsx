import { LogOut } from 'lucide-react';
import { AuthHeading, AuthShell, GlassPanel } from '@/components/AuthShell';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { TwoFactorCard } from '@/pages/AccountPage';

// Shown instead of the app while the admin requires 2FA for this account and
// none is set up; the server refuses everything else until then.
export const MfaSetupGate = () => {
  const { t } = useI18n();
  const { signOut, refreshSession } = useAuth();
  return (
    <AuthShell wide>
      <GlassPanel>
        <AuthHeading title={t('mfaSetupTitle')} subtitle={t('mfaSetupHint')} />
        <TwoFactorCard plain onEnabled={() => void refreshSession()} />
      </GlassPanel>
      <button
        type="button"
        onClick={() => void signOut()}
        className="mx-auto mt-5 flex items-center gap-1.5 text-sm font-medium text-text-secondary transition-colors hover:text-text"
      >
        <LogOut size={15} />
        {t('signOut')}
      </button>
    </AuthShell>
  );
};
