import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { config } from '@/lib/config';
import { api } from '@/lib/api';
import { safeRedirectPath } from '@/lib/safePath';

export const LoginPage = () => {
  const { t } = useI18n();
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Deep link the user originally requested before being sent to /login.
  const from = safeRedirectPath((location.state as { from?: string } | null)?.from);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [allowSelfSignup, setAllowSelfSignup] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signedUp, setSignedUp] = useState(false);
  // Second step for accounts with two-factor authentication.
  const [mfaStep, setMfaStep] = useState(false);
  const [code, setCode] = useState('');

  useEffect(() => {
    // Whether the sign-up option is offered is an instance setting readable
    // without a session.
    api.rpc('get_public_config').then(({ data }) => {
      setAllowSelfSignup(
        Boolean((data as { allow_self_signup?: boolean } | null)?.allow_self_signup),
      );
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
          data: { name: name.trim() },
        },
      });
      setSubmitting(false);
      if (error) {
        setError(error.message);
        return;
      }
      // With email confirmation enabled there is no session yet; the user
      // first has to click the link in the email.
      if (!data.session) {
        setSignedUp(true);
        return;
      }
      navigate(from ?? '/', { replace: true });
      return;
    }

    const { error, mfaRequired } = await signIn(email, password, mfaStep ? code : undefined);
    setSubmitting(false);
    if (error) {
      // Surface the real server message (e.g. "Email not confirmed") rather
      // than masking every failure as bad credentials.
      setError(/invalid login/i.test(error) ? t('invalidCredentials') : error);
      return;
    }
    if (mfaRequired) {
      setMfaStep(true);
      return;
    }
    navigate(from ?? '/', { replace: true });
  };

  const switchMode = (next: 'signin' | 'signup') => {
    setMode(next);
    setError(null);
    setSignedUp(false);
    setMfaStep(false);
    setCode('');
  };

  return (
    <div className="flex h-full items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <img src="/favicon.svg" alt="" className="h-6 w-6" />
          <span className="text-lg font-semibold">{config.appName}</span>
        </div>

        <div className="bg-surface border border-border rounded-md p-6">
          {signedUp ? (
            <div className="py-4 text-center" role="status">
              <MailCheck size={38} className="mx-auto text-[#16a34a]" />
              <h1 className="mt-4 text-lg font-semibold">{t('confirmEmailTitle')}</h1>
              <p className="text-text-secondary text-sm mt-2">{t('confirmEmailHint')}</p>
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

              {mfaStep ? (
                <form onSubmit={onSubmit} className="space-y-4">
                  <Input
                    id="code"
                    label={t('twoFactorCode')}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9 ]*"
                    maxLength={7}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoFocus
                    required
                  />
                  {error && <p className="text-sm text-accent">{error}</p>}
                  <Button type="submit" className="w-full" disabled={submitting || code.trim().length < 6}>
                    {submitting ? t('loading') : t('signIn')}
                  </Button>
                  <button
                    type="button"
                    onClick={() => switchMode('signin')}
                    className="w-full text-sm font-medium text-text-secondary hover:text-text underline"
                  >
                    {t('back')}
                  </button>
                </form>
              ) : (
                <form onSubmit={onSubmit} className="space-y-4">
                  {mode === 'signup' && (
                    <Input
                      id="name"
                      label={t('name')}
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
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
      </div>
    </div>
  );
};
