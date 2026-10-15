import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CircleCheck, CircleX } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { PageSpinner } from '@/components/Spinner';
import { AuthHeading, AuthShell, GlassPanel } from '@/components/AuthShell';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';

// Target of the emailed reset link (/reset-password?token=…). Works signed in
// or not; afterwards every device is signed out, so the user signs in again.
export const ResetPasswordPage = () => {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const token = new URLSearchParams(location.search).get('token') ?? '';
  const [state, setState] = useState<'checking' | 'invalid' | 'form' | 'done'>('checking');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setState('invalid');
      return;
    }
    api.auth.checkPasswordReset(token).then(({ data }) => setState(data?.valid ? 'form' : 'invalid'));
  }, [token]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== repeat) {
      setError(t('passwordsDontMatch'));
      return;
    }
    setSubmitting(true);
    const { error } = await api.auth.resetPassword(token, password);
    setSubmitting(false);
    if (error) {
      if (error.code === 'reset_link_invalid') setState('invalid');
      else setError(error.message);
      return;
    }
    // The server ended every session, this one included.
    await api.auth.signOut();
    setState('done');
  };

  if (state === 'checking') return <PageSpinner />;

  return (
    <AuthShell>
      <GlassPanel>
        {state === 'form' ? (
          <>
            <AuthHeading title={t('resetPasswordTitle')} subtitle={t('resetPasswordSubtitle')} />
            <form onSubmit={onSubmit} className="space-y-4">
              <Input
                id="new-password"
                type="password"
                label={t('newPassword')}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
              <Input
                id="repeat-password"
                type="password"
                label={t('repeatPassword')}
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                minLength={8}
                required
              />
              {error && (
                <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-strong" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? t('loading') : t('setNewPassword')}
              </Button>
            </form>
          </>
        ) : (
          <div className="py-2 text-center" role="status">
            <span
              className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${
                state === 'done' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger-strong'
              }`}
            >
              {state === 'done' ? <CircleCheck size={28} /> : <CircleX size={28} />}
            </span>
            <h1 className="mt-5 text-xl font-semibold tracking-tight">
              {state === 'done' ? t('passwordResetDoneTitle') : t('resetLinkInvalidTitle')}
            </h1>
            <p className="text-text-secondary text-sm mt-2">
              {state === 'done' ? t('passwordResetDoneHint') : t('resetLinkInvalidHint')}
            </p>
            <Button type="button" variant="secondary" className="mt-6 w-full" onClick={() => navigate('/login')}>
              {t('signIn')}
            </Button>
          </div>
        )}
      </GlassPanel>
    </AuthShell>
  );
};
