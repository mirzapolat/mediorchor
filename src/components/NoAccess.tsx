import { useNavigate } from 'react-router-dom';
import { LockKeyhole } from 'lucide-react';
import { Button } from '@/components/Button';
import { AuthHeading, AuthShell, GlassPanel } from '@/components/AuthShell';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/lib/i18n';

// Shown instead of silently redirecting when a link points at something this
// account can't see. RLS can't tell "deleted" from "not yours", so the text
// covers both and suggests the most common cause: signed in with another email.
// Switching accounts signs out on the current URL, so the login page sends the
// user right back here afterwards.
const NoAccessContent = () => {
  const { t } = useI18n();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted">
        <LockKeyhole size={22} className="text-text-secondary" />
      </div>
      <AuthHeading title={t('noAccessTitle')} subtitle={t('noAccessText')} />
      {user?.email && (
        <p className="-mt-2 mb-6 text-sm text-text-secondary">
          {t('noAccessSignedInAs')} <span className="font-medium text-text break-all">{user.email}</span>
          <br />
          {t('noAccessWrongEmail')}
        </p>
      )}
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
        <Button onClick={() => void signOut()}>{t('noAccessSwitchAccount')}</Button>
        <Button variant="secondary" onClick={() => navigate('/', { replace: true })}>
          {t('noAccessHome')}
        </Button>
      </div>
    </div>
  );
};

// `standalone` for layouts without app chrome (project, event, admin);
// otherwise it renders inside the surrounding page.
export const NoAccess = ({ standalone }: { standalone?: boolean }) =>
  standalone ? (
    <AuthShell wide>
      <GlassPanel>
        <NoAccessContent />
      </GlassPanel>
    </AuthShell>
  ) : (
    <div className="mx-auto max-w-md py-16">
      <NoAccessContent />
    </div>
  );
