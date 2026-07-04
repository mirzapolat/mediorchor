import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { config } from '@/lib/config';
import { safeRedirectPath } from '@/lib/safePath';

export const LoginPage = () => {
  const { t } = useI18n();
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Deep link the user originally requested before being sent to /login.
  const from = safeRedirectPath((location.state as { from?: string } | null)?.from);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await signIn(email, password);
    setSubmitting(false);
    if (error) {
      // Surface the real Supabase message (e.g. "Email not confirmed") rather
      // than masking every failure as bad credentials.
      setError(/invalid/i.test(error) ? t('invalidCredentials') : error);
      return;
    }
    navigate(from ?? '/', { replace: true });
  };

  return (
    <div className="flex h-full items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <img src="/favicon.svg" alt="" className="h-6 w-6" />
          <span className="text-lg font-semibold">{config.appName}</span>
        </div>

        <div className="bg-surface border border-border rounded-md p-6">
          <h1 className="text-xl font-semibold">{t('loginTitle')}</h1>
          <p className="text-text-secondary text-sm mt-1 mb-6">{t('loginSubtitle')}</p>

          <form onSubmit={onSubmit} className="space-y-4">
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {error && <p className="text-sm text-accent">{error}</p>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? t('loading') : t('signIn')}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};
