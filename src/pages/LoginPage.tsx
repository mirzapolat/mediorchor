import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Fingerprint, MailCheck } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { config } from '@/lib/config';
import { api, type ApiError, type MfaChallenge } from '@/lib/api';
import { passkeysSupported } from '@/lib/passkeys';
import { SecondFactorForm, mfaErrorMessage } from '@/components/SecondFactorForm';
import { safeRedirectPath } from '@/lib/safePath';
import { LegalFooter } from '@/components/LegalLinks';
import { AppLogo } from '@/components/AppLogo';

export const LoginPage = () => {
  const { t } = useI18n();
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Deep link the user originally requested before being sent to /login.
  const from = safeRedirectPath((location.state as { from?: string } | null)?.from);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [allowSelfSignup, setAllowSelfSignup] = useState(false);
  // Whether sign-ups get a confirmation email first (server has SMTP).
  const [mailEnabled, setMailEnabled] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signedUp, setSignedUp] = useState(false);
  // Self sign-up waiting for admin approval (also after the email link: ?pending=1).
  const [approvalPending, setApprovalPending] = useState(
    () => new URLSearchParams(location.search).get('pending') === '1',
  );
  // Second step for accounts with two-factor authentication.
  const [mfa, setMfa] = useState<MfaChallenge | null>(null);
  const mfaStep = mfa !== null;

  useEffect(() => {
    // Whether the sign-up option is offered is an instance setting readable
    // without a session.
    api.rpc('get_public_config').then(({ data }) => {
      setAllowSelfSignup(
        Boolean((data as { allow_self_signup?: boolean } | null)?.allow_self_signup),
      );
      setMailEnabled(Boolean((data as { mail_enabled?: boolean } | null)?.mail_enabled));
    });
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    if (mode === 'signup') {
      const { data, error } = await api.auth.signUp({
        email,
        password,
        options: {
          data: { name: `${firstName.trim()} ${lastName.trim()}` },
        },
      });
      setSubmitting(false);
      if (error) {
        setError(error.code === 'signup_domain_not_allowed' ? t('signupDomainNotAllowed') : error.message);
        return;
      }
      // With email confirmation enabled there is no session yet; the user
      // first has to click the link in the email. With approval on, an
      // administrator has to release the account as well.
      if (!data.session) {
        setApprovalPending(data.approvalPending);
        setSignedUp(true);
        return;
      }
      navigate(from ?? '/', { replace: true });
      return;
    }

    const { error, mfa: challenge } = await signIn(email, password);
    setSubmitting(false);
    if (error) {
      setError(signInError(error));
      return;
    }
    if (challenge) {
      setMfa(challenge);
      return;
    }
    navigate(from ?? '/', { replace: true });
  };

  // Surface the real server message (e.g. "Email not confirmed") rather than
  // masking every failure as bad credentials.
  const signInError = (error: ApiError) =>
    error.code === 'invalid_credentials'
      ? t('invalidCredentials')
      : error.code === 'approval_pending'
        ? t('loginApprovalPending')
        : mfaErrorMessage(error, t);

  const completeSignIn = async (proof: Parameters<typeof api.auth.completeSignIn>[1]) => {
    if (!mfa) return null;
    const { error } = await api.auth.completeSignIn(mfa.challenge_id, proof);
    if (error) {
      // Too many wrong codes or too slow: start over with the password.
      if (error.code === 'mfa_challenge_expired') {
        setMfa(null);
        setError(t('mfaExpired'));
        return null;
      }
      return error;
    }
    navigate(from ?? '/', { replace: true });
    return null;
  };

  const signInWithPasskey = async () => {
    setError(null);
    setSubmitting(true);
    const { error } = await api.auth.signInWithPasskey();
    setSubmitting(false);
    if (error) {
      setError(signInError(error));
      return;
    }
    navigate(from ?? '/', { replace: true });
  };

  const needsEmailConfirm = signedUp && mailEnabled;

  const switchMode = (next: 'signin' | 'signup') => {
    setMode(next);
    setError(null);
    setSignedUp(false);
    setApprovalPending(false);
    setMfa(null);
  };

  return (
    <div className="flex h-full items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <AppLogo className="h-6 w-6" />
          <span className="text-lg font-semibold">{config.appName}</span>
        </div>

        <div className="bg-surface border border-border rounded-md p-6">
          {signedUp || approvalPending ? (
            <div className="py-4 text-center" role="status">
              <MailCheck size={38} className="mx-auto text-success" />
              <h1 className="mt-4 text-lg font-semibold">
                {needsEmailConfirm ? t('confirmEmailTitle') : t('approvalPendingTitle')}
              </h1>
              <p className="text-text-secondary text-sm mt-2">
                {needsEmailConfirm ? t('confirmEmailHint') : t('approvalPendingLoginHint')}
              </p>
              {needsEmailConfirm && approvalPending ? (
                <p className="text-text-secondary text-sm mt-2">{t('approvalAfterConfirmHint')}</p>
              ) : null}
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="mt-5 text-sm font-medium text-text-secondary hover:text-text underline"
              >
                {t('signIn')}
              </button>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-semibold">
                {mode === 'signup' ? t('signUpTitle') : t('loginTitle')}
              </h1>
              <p className="text-text-secondary text-sm mt-1 mb-6">
                {mfaStep ? t('twoFactorPrompt') : mode === 'signup' ? t('signUpSubtitle') : t('loginSubtitle')}
              </p>

              {mfa ? (
                <div className="space-y-4">
                  <SecondFactorForm challenge={mfa} submitLabel={t('signIn')} onSubmit={completeSignIn} />
                  <button
                    type="button"
                    onClick={() => switchMode('signin')}
                    className="w-full text-sm font-medium text-text-secondary hover:text-text underline"
                  >
                    {t('back')}
                  </button>
                </div>
              ) : (
                <form onSubmit={onSubmit} className="space-y-4">
                  {mode === 'signup' && (
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        id="first-name"
                        label={t('firstName')}
                        autoComplete="given-name"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        required
                      />
                      <Input
                        id="last-name"
                        label={t('lastName')}
                        autoComplete="family-name"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        required
                      />
                    </div>
                  )}
                  <Input
                    id="email"
                    type="email"
                    label={t('email')}
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                  <Input
                    id="password"
                    type="password"
                    label={t('password')}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={mode === 'signup' ? 8 : undefined}
                    required
                  />
                  {error && <p className="text-sm text-accent">{error}</p>}
                  <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting ? t('loading') : mode === 'signup' ? t('signUp') : t('signIn')}
                  </Button>
                  {mode === 'signin' && passkeysSupported() && (
                    <>
                      <div className="flex items-center gap-3 text-xs text-text-tertiary">
                        <span className="h-px flex-1 bg-border" />
                        {t('or')}
                        <span className="h-px flex-1 bg-border" />
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full"
                        disabled={submitting}
                        onClick={() => void signInWithPasskey()}
                      >
                        <Fingerprint size={16} />
                        {t('signInWithPasskey')}
                      </Button>
                    </>
                  )}
                </form>
              )}

              {allowSelfSignup && !mfaStep && (
                <p className="text-sm text-text-secondary mt-5 text-center">
                  {mode === 'signup' ? (
                    <>
                      {t('haveAccount')}{' '}
                      <button
                        type="button"
                        onClick={() => switchMode('signin')}
                        className="font-medium text-text underline"
                      >
                        {t('signIn')}
                      </button>
                    </>
                  ) : (
                    <>
                      {t('noAccount')}{' '}
                      <button
                        type="button"
                        onClick={() => switchMode('signup')}
                        className="font-medium text-text underline"
                      >
                        {t('signUp')}
                      </button>
                    </>
                  )}
                </p>
              )}
            </>
          )}
        </div>
        <LegalFooter className="mt-8" />
      </div>
    </div>
  );
};
