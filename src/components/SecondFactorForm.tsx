import { useState, type FormEvent } from 'react';
import { Fingerprint, KeyRound, Lock, Mail } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { api, type ApiError, type MfaChallenge, type MfaProof } from '@/lib/api';
import { getPasskey, passkeysSupported } from '@/lib/passkeys';
import { cn } from '@/lib/cn';

type Method = MfaChallenge['methods'][number];

const METHODS: Record<Method, { label: TranslationKey; icon: typeof KeyRound }> = {
  passkey: { label: 'mfaMethodPasskey', icon: Fingerprint },
  totp: { label: 'mfaMethodTotp', icon: KeyRound },
  email: { label: 'mfaMethodEmail', icon: Mail },
  password: { label: 'password', icon: Lock },
};
const ORDER: Method[] = ['passkey', 'totp', 'email', 'password'];

// Messages for the errors a second-factor check can end with.
export const mfaErrorMessage = (error: ApiError, t: (key: TranslationKey) => string): string | null => {
  const messages: Partial<Record<string, TranslationKey>> = {
    mfa_verification_failed: 'mfaWrongCode',
    mfa_challenge_expired: 'mfaExpired',
    mfa_email_throttled: 'mfaEmailWait',
    email_send_failed: 'mfaEmailFailed',
    invalid_credentials: 'deleteAccountWrongPassword',
    passkey_unknown: 'passkeyUnknown',
    passkey_exists: 'passkeyExists',
    passkey_invalid: 'passkeyFailed',
    passkey_failed: 'passkeyFailed',
    mfa_enforced: 'disable2faEnforced',
  };
  // Closing the passkey prompt is a choice, not an error.
  if (error.code === 'passkey_cancelled') return null;
  const key = messages[error.code ?? ''];
  return key ? t(key) : error.message;
};

// Answers a second-factor challenge (sign-in or re-confirmation) with one of
// its methods: authenticator code, passkey, emailed code or (for accounts
// without 2FA) the password. onSubmit returns the error to show, or null.
export const SecondFactorForm = ({
  challenge,
  onSubmit,
  submitLabel,
}: {
  challenge: MfaChallenge;
  onSubmit: (proof: MfaProof) => Promise<ApiError | null>;
  submitLabel: string;
}) => {
  const { t } = useI18n();
  const methods = ORDER.filter(
    (m) => challenge.methods.includes(m) && (m !== 'passkey' || passkeysSupported()),
  );
  const [method, setMethod] = useState<Method>(methods[0] ?? 'totp');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = (next: Method) => {
    setMethod(next);
    setCode('');
    setError(null);
  };

  const submit = async (proof: MfaProof) => {
    setBusy(true);
    setError(null);
    const result = await onSubmit(proof);
    setBusy(false);
    if (result) {
      setError(mfaErrorMessage(result, t));
      setCode('');
    }
  };

  const sendEmail = async () => {
    setBusy(true);
    setError(null);
    const { error: sendError } = await api.auth.mfa.sendChallengeEmail(challenge.challenge_id);
    setBusy(false);
    if (sendError) {
      setError(mfaErrorMessage(sendError, t));
      return;
    }
    setEmailSent(true);
  };

  const confirmWithPasskey = async () => {
    setBusy(true);
    setError(null);
    const { data, error: optionsError } = await api.auth.mfa.challengePasskeyOptions(challenge.challenge_id);
    if (optionsError || !data) {
      setBusy(false);
      setError(optionsError ? mfaErrorMessage(optionsError, t) : null);
      return;
    }
    const prompt = await getPasskey(data.options);
    if (prompt.error) {
      setBusy(false);
      setError(mfaErrorMessage(prompt.error, t));
      return;
    }
    await submit({ method: 'passkey', credential: prompt.credential });
  };

  const onCodeSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (method === 'password') void submit({ method: 'password', password });
    else if (method === 'totp' || method === 'email') void submit({ method, code });
  };

  const codeInput = (
    <Input
      id="mfa-code"
      label={t('twoFactorCode')}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="123456"
      maxLength={7}
      value={code}
      onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
      className="max-w-[180px] tracking-widest"
      autoFocus
      required
    />
  );

  // Only passkeys, and this browser can't use them.
  if (methods.length === 0) return <p className="text-sm text-danger-strong">{t('passkeyUnsupported')}</p>;

  return (
    <div className="space-y-4">
      {methods.length > 1 && (
        <div
          role="radiogroup"
          aria-label={t('mfaChooseMethod')}
          className={cn('grid gap-2', methods.length === 2 ? 'grid-cols-2' : 'grid-cols-3')}
        >
          {methods.map((m) => {
            const { label, icon: Icon } = METHODS[m];
            const active = m === method;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => choose(m)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-md border px-2 py-2.5 text-xs font-medium transition-colors duration-150',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1',
                  active
                    ? 'border-black bg-surface-muted text-text'
                    : 'border-border text-text-secondary hover:bg-surface-subtle hover:text-text',
                )}
              >
                <Icon size={17} />
                {t(label)}
              </button>
            );
          })}
        </div>
      )}

      {method === 'passkey' ? (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">{t('mfaPasskeyPrompt')}</p>
          <Button type="button" className="w-full" onClick={() => void confirmWithPasskey()} disabled={busy}>
            <Fingerprint size={16} />
            {busy ? t('loading') : t('mfaUsePasskey')}
          </Button>
        </div>
      ) : method === 'email' && !emailSent ? (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">{t('mfaEmailPrompt')}</p>
          <Button type="button" className="w-full" onClick={() => void sendEmail()} disabled={busy}>
            <Mail size={16} />
            {busy ? t('loading') : t('mfaSendEmail')}
          </Button>
        </div>
      ) : (
        <form onSubmit={onCodeSubmit} className="space-y-4">
          <p className="text-sm text-text-secondary">
            {method === 'totp' ? t('twoFactorPrompt') : method === 'email' ? t('mfaEmailSent') : t('reauthPasswordPrompt')}
          </p>
          {method === 'password' ? (
            <Input
              id="mfa-password"
              type="password"
              label={t('password')}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
            />
          ) : (
            codeInput
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={busy || (method === 'password' ? !password : code.replace(/\s/g, '').length < 6)}
          >
            {busy ? t('loading') : submitLabel}
          </Button>
          {method === 'email' && (
            <button
              type="button"
              onClick={() => void sendEmail()}
              disabled={busy}
              className="w-full text-sm font-medium text-text-secondary hover:text-text underline"
            >
              {t('mfaResendEmail')}
            </button>
          )}
        </form>
      )}
      {error && (
        <p className="text-sm text-danger-strong" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
