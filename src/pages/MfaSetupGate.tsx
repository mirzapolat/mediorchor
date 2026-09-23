import { LogOut } from 'lucide-react';
import { AppLogo } from '@/components/AppLogo';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { TwoFactorCard } from '@/pages/AccountPage';

// Shown instead of the app while the admin requires 2FA for this account and
// none is set up; the server refuses everything else until then.
export const MfaSetupGate = () => {
  const { t } = useI18n();
  const { signOut, refreshSession } = useAuth();
  return (
    <main className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-5">
        <div className="text-center">
          <AppLogo className="mx-auto mb-4 h-10 w-10" />
          <h1 className="text-xl font-bold">{t('mfaSetupTitle')}</h1>
          <p className="mt-2 text-sm text-text-secondary">{t('mfaSetupHint')}</p>
        </div>
        <TwoFactorCard onEnabled={() => void refreshSession()} />
        <button
          type="button"
          onClick={() => void signOut()}
          className="mx-auto flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text"
        >
          <LogOut size={15} />
          {t('signOut')}
        </button>
      </div>
    </main>
  );
};
