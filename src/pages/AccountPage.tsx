import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Check,
  Copy,
  Fingerprint,
  KeyRound,
  Laptop,
  LogOut,
  Mail,
  Monitor,
  Moon,
  Plus,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Avatar } from '@/components/Avatar';
import { PageSpinner } from '@/components/Spinner';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { mfaErrorMessage } from '@/components/SecondFactorForm';
import { useI18n } from '@/lib/i18n';
import { api, type ApiError, type DeviceSession, type MfaFactors } from '@/lib/api';
import { createPasskey, passkeysSupported } from '@/lib/passkeys';
import { useReauth } from '@/hooks/useReauth';
import { useAuth } from '@/hooks/useAuth';
import { useProfilePhoto } from '@/hooks/useProfilePhoto';
import type { Language } from '@/lib/config';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { CardColumns } from '@/components/CardColumns';
import { cn } from '@/lib/cn';

export const AccountPage = () => {
  const { t, lang, setLang } = useI18n();
  const { user, session, refreshUser } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(session?.user.email ?? '');
  const [password, setPassword] = useState('');
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const photo = useProfilePhoto();
  const photoBusy = photo.busy;
  const photoError = photo.error;
  const reauth = useReauth();

  if (!user) return <PageSpinner />;

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProfileMsg(null);
    await api.from('app_users').update({ name: name.trim() }).eq('id', user.id);
    const authUpdate: { email?: string; password?: string } = {};
    if (email && email !== session?.user.email) authUpdate.email = email;
    if (password) authUpdate.password = password;
    let emailChangePending = false;
    if (Object.keys(authUpdate).length > 0) {
      const { data, error } = await reauth.run(() => api.auth.updateUser(authUpdate));
      if (error) {
        setProfileMsg(error.code === 'reauth_cancelled' ? null : error.message);
        setBusy(false);
        return;
      }
      emailChangePending = data.emailChangePending;
    }
    await refreshUser();
    setPassword('');
    setProfileMsg(emailChangePending ? t('emailChangePending') : '✓');
    setBusy(false);
  };

  return (
    <>
      <PageHeader title={t('account')} subtitle={user.email} />

      <CardColumns>
        <form onSubmit={saveProfile}>
          <Card className="space-y-4">
            <h2 className="text-base font-medium">{t('account')}</h2>
            <div>
              <p className="text-sm font-medium text-text mb-1.5">{t('profilePhoto')}</p>
              <div className="flex items-center gap-4">
                <Avatar name={user.name || user.email} photoUrl={user.photo_url} size={56} />
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-sm font-medium text-text-secondary border border-border rounded-md px-3 py-2 cursor-pointer hover:bg-surface-muted transition-colors duration-150">
                    <Upload size={15} />
                    {photoBusy ? t('loading') : user.photo_url ? t('changePhoto') : t('uploadPhoto')}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={photoBusy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) photo.choose(file);
                      }}
                    />
                  </label>
                  {user.photo_url && (
                    <button
                      type="button"
                      disabled={photoBusy}
                      onClick={() => void photo.remove()}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text transition-colors duration-150"
                    >
                      <X size={15} />
                      {t('remove')}
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-1.5 text-sm text-text-secondary">{t('profilePhotoHint')}</p>
              {photoError && <p className="mt-1 text-sm text-accent">{photoError}</p>}
            </div>
            <Input label={t('name')} value={name} onChange={(e) => setName(e.target.value)} required />
            <Input
              type="email"
              label={t('email')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              type="password"
              label={t('newPassword')}
              placeholder="••••••••"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy}>
                {busy ? t('loading') : t('save')}
              </Button>
              {profileMsg && <span className="text-sm text-text-secondary">{profileMsg}</span>}
            </div>
          </Card>
        </form>

        <Card className="space-y-4">
          <h2 className="text-base font-medium">{t('language')}</h2>
          <Select
            value={lang}
            onChange={(e) => {
              const next = e.target.value as Language;
              setLang(next);
              // Emails use the account's language.
              if (user) void api.from('app_users').update({ language: next }).eq('id', user.id);
            }}
            className="max-w-[200px]"
          >
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </Select>
        </Card>

        <AppearanceCard />

        <NotificationsCard />

        <SessionsCard />

        <TwoFactorCard />

        <DeleteAccountCard />
      </CardColumns>
      {photo.cropper}
      {reauth.modal}
    </>
  );
};

// Two-factor authentication: authenticator app, passkeys and (when the admin
// allows them and email works) codes by email. Any one active method makes
// sign-in ask for a second step. Also used by the required-2FA setup screen
// (onEnabled continues from there; plain drops the card frame to sit inside
// that screen's own panel).
export const TwoFactorCard = ({ onEnabled, plain }: { onEnabled?: () => void; plain?: boolean } = {}) => {
  const { t } = useI18n();
  const reauth = useReauth();
  const [factors, setFactors] = useState<MfaFactors | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const { data } = await api.auth.mfa.listFactors();
    setFactors(data);
    return data;
  };

  useEffect(() => {
    void refresh();
  }, []);

  // Shows the error of an action (unless the confirmation was cancelled);
  // true when it succeeded.
  const done = async (result: { error: ApiError | null }) => {
    if (result.error) {
      if (result.error.code !== 'reauth_cancelled') setError(mfaErrorMessage(result.error, t));
      return false;
    }
    setError(null);
    const data = await refresh();
    if (data && data.methods.length > 0) onEnabled?.();
    return true;
  };

  if (!factors) return null;
  const enabled = factors.methods.length > 0;

  return (
    <Card className={cn('space-y-4', plain && '!border-0 !bg-transparent !p-0')}>
      <div>
        {/* The setup screen has its own title. */}
        {!plain && (
          <h2 className="text-base font-medium flex items-center gap-2 mb-1">
            {enabled ? (
              <ShieldCheck size={18} className="text-accent" />
            ) : (
              <ShieldOff size={18} className="text-text-secondary" />
            )}
            {t('twoFactor')}
          </h2>
        )}
        <p className="text-sm text-text-secondary">{enabled ? t('twoFactorOnHint') : t('twoFactorOffHint')}</p>
      </div>

      <AuthenticatorSection factors={factors} run={reauth.run} done={done} />
      <PasskeySection factors={factors} run={reauth.run} done={done} />
      {(factors.email.available || factors.email.enabled) && (
        <EmailCodeSection factors={factors} run={reauth.run} done={done} />
      )}

      {error && <p className="text-sm text-danger-strong">{error}</p>}
      {reauth.modal}
    </Card>
  );
};

interface MethodSectionProps {
  factors: MfaFactors;
  run: ReturnType<typeof useReauth>['run'];
  done: (result: { error: ApiError | null }) => Promise<boolean>;
}

const MethodSection = ({
  icon: Icon,
  title,
  hint,
  active,
  action,
  children,
}: {
  icon: typeof KeyRound;
  title: string;
  hint: string;
  active: boolean;
  action?: ReactNode;
  children?: ReactNode;
}) => {
  const { t } = useI18n();
  return (
    <section className="space-y-3 border-t border-border pt-4">
      <div className="flex items-start gap-3">
        <Icon size={18} className="mt-0.5 flex-shrink-0 text-text-secondary" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 font-medium">
            {title}
            {active && (
              <span className="rounded-md bg-success-soft-strong px-1.5 py-0.5 text-xs font-semibold text-success-strong">
                {t('twoFactorOn')}
              </span>
            )}
          </p>
          <p className="text-sm text-text-secondary mt-0.5">{hint}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
};

// "JBSW Y3DP EHPK 3PXP" — easier to type into an authenticator app.
const groupSecret = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

const AuthenticatorSection = ({ factors, run, done }: MethodSectionProps) => {
  const { t } = useI18n();
  const active = factors.totp.find((f) => f.status === 'verified');
  const [setup, setSetup] = useState<{ id: string; secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const start = async () => {
    setBusy(true);
    const result = await run(() => api.auth.mfa.enroll());
    setBusy(false);
    if (result.data) setSetup({ id: result.data.id, ...result.data.totp });
    else await done(result);
  };

  const cancel = async () => {
    if (setup) await api.auth.mfa.unenroll({ factorId: setup.id });
    setSetup(null);
    setCode('');
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!setup) return;
    setBusy(true);
    const ok = await done(await api.auth.mfa.verify({ factorId: setup.id, code }));
    setBusy(false);
    setCode('');
    if (ok) setSetup(null);
  };

  const copySecret = async () => {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard unavailable: the key stays visible for manual copying */
    }
  };

  const remove = async () => {
    setConfirmRemove(false);
    if (!active) return;
    setBusy(true);
    await done(await run(() => api.auth.mfa.unenroll({ factorId: active.id })));
    setBusy(false);
  };

  return (
    <MethodSection
      icon={KeyRound}
      title={t('mfaMethodTotpTitle')}
      hint={t('mfaMethodTotpHint')}
      active={Boolean(active)}
      action={
        active ? (
          <Button variant="secondary" disabled={busy} onClick={() => setConfirmRemove(true)}>
            {t('remove')}
          </Button>
        ) : !setup ? (
          <Button variant="secondary" disabled={busy} onClick={() => void start()}>
            {t('mfaSetUp')}
          </Button>
        ) : null
      }
    >
      {setup && (
        <form onSubmit={verify} className="space-y-4">
          <p className="text-sm text-text-secondary">{t('totpScanHint')}</p>
          <a href={setup.uri} className="inline-block" title={t('totpOpenApp')}>
            <QRCodeSVG
              value={setup.uri}
              size={176}
              marginSize={2}
              title="TOTP QR"
              className="border border-border rounded-md bg-paper"
            />
          </a>
          <div>
            <p className="text-sm font-medium mb-1.5">{t('totpManualKey')}</p>
            <div className="flex items-center gap-2">
              <code
                className="min-w-0 flex-1 break-all rounded-md border border-border bg-surface-muted px-3 py-2 font-mono text-sm tracking-wider select-all"
                aria-label={t('totpManualKey')}
              >
                {groupSecret(setup.secret)}
              </code>
              <Button type="button" variant="secondary" onClick={() => void copySecret()} title={t('copy')}>
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? t('copied') : t('copy')}
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-text-secondary">{t('totpManualHint')}</p>
          </div>
          <Input
            label={t('twoFactorCode')}
            placeholder="123456"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
            className="max-w-[180px] tracking-widest"
            required
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || code.replace(/\s/g, '').length < 6}>
              {busy ? t('loading') : t('confirm')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => void cancel()}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}
      <ConfirmDialog
        open={confirmRemove}
        title={t('mfaRemoveTotpTitle')}
        message={t('mfaRemoveTotpConfirm')}
        confirmLabel={t('remove')}
        destructive
        onConfirm={() => void remove()}
        onCancel={() => setConfirmRemove(false)}
      />
    </MethodSection>
  );
};

const PasskeySection = ({ factors, run, done }: MethodSectionProps) => {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<MfaFactors['passkeys'][number] | null>(null);
  const supported = passkeysSupported();

  const add = async () => {
    setBusy(true);
    const options = await run(() => api.auth.mfa.passkeyOptions());
    if (!options.data) {
      await done(options);
      setBusy(false);
      return;
    }
    const prompt = await createPasskey(options.data.options);
    if (prompt.error) {
      await done({ error: prompt.error });
      setBusy(false);
      return;
    }
    await done(
      await api.auth.mfa.addPasskey({
        challengeId: options.data.challenge_id,
        credential: prompt.credential,
        name: describeDevice(navigator.userAgent).label ?? '',
      }),
    );
    setBusy(false);
  };

  const remove = async () => {
    const passkey = removing;
    setRemoving(null);
    if (!passkey) return;
    setBusy(true);
    await done(await run(() => api.auth.mfa.removePasskey(passkey.id)));
    setBusy(false);
  };

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'medium' });

  return (
    <MethodSection
      icon={Fingerprint}
      title={t('mfaMethodPasskeyTitle')}
      hint={supported ? t('mfaMethodPasskeyHint') : t('passkeyUnsupported')}
      active={factors.passkeys.length > 0}
      action={
        supported ? (
          <Button variant="secondary" disabled={busy} onClick={() => void add()}>
            <Plus size={15} />
            {busy ? t('loading') : t('passkeyAdd')}
          </Button>
        ) : null
      }
    >
      {factors.passkeys.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {factors.passkeys.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.name || t('mfaMethodPasskey')}</p>
                <p className="text-xs text-text-secondary">
                  {t('passkeyAdded')}: {date(p.created_at)}
                  {p.last_used_at ? ` · ${t('passkeyLastUsed')}: ${date(p.last_used_at)}` : ''}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setRemoving(p)}
                title={t('remove')}
                aria-label={`${t('remove')}: ${p.name}`}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-danger-soft hover:text-danger-strong disabled:opacity-50"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={removing !== null}
        title={t('passkeyRemoveTitle')}
        message={t('passkeyRemoveConfirm').replace('{name}', removing?.name || t('mfaMethodPasskey'))}
        confirmLabel={t('remove')}
        destructive
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </MethodSection>
  );
};

const EmailCodeSection = ({ factors, run, done }: MethodSectionProps) => {
  const { t } = useI18n();
  const { session } = useAuth();
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const { enabled, available } = factors.email;

  const start = async () => {
    setBusy(true);
    const result = await run(() => api.auth.mfa.enrollEmail());
    setBusy(false);
    if (result.data) setChallengeId(result.data.challenge_id);
    else await done(result);
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!challengeId) return;
    setBusy(true);
    const result = await api.auth.mfa.verifyEmail({ challengeId, code });
    setBusy(false);
    setCode('');
    if (result.error?.code === 'mfa_challenge_expired') setChallengeId(null);
    if (await done(result)) setChallengeId(null);
  };

  const disable = async () => {
    setConfirmDisable(false);
    setBusy(true);
    await done(await run(() => api.auth.mfa.disableEmail()));
    setBusy(false);
  };

  return (
    <MethodSection
      icon={Mail}
      title={t('mfaMethodEmailTitle')}
      hint={available ? t('mfaMethodEmailHint') : t('mfaMethodEmailUnavailable')}
      active={enabled && available}
      action={
        enabled ? (
          <Button variant="secondary" disabled={busy} onClick={() => setConfirmDisable(true)}>
            {t('mfaTurnOff')}
          </Button>
        ) : !challengeId ? (
          <Button variant="secondary" disabled={busy} onClick={() => void start()}>
            {busy ? t('loading') : t('mfaTurnOn')}
          </Button>
        ) : null
      }
    >
      {challengeId && (
        <form onSubmit={verify} className="space-y-4">
          <p className="text-sm text-text-secondary">
            {t('mfaEmailEnrollSent').replace('{email}', session?.user.email ?? '')}
          </p>
          <Input
            label={t('twoFactorCode')}
            placeholder="123456"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
            className="max-w-[180px] tracking-widest"
            autoFocus
            required
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || code.replace(/\s/g, '').length < 6}>
              {busy ? t('loading') : t('confirm')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setChallengeId(null)}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}
      <ConfirmDialog
        open={confirmDisable}
        title={t('mfaMethodEmailTitle')}
        message={t('mfaEmailDisableConfirm')}
        confirmLabel={t('mfaTurnOff')}
        destructive
        onConfirm={() => void disable()}
        onCancel={() => setConfirmDisable(false)}
      />
    </MethodSection>
  );
};

// Permanently deletes the own account after re-entering the password (and,
// with 2FA, confirming with a second factor).
const DeleteAccountCard = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const reauth = useReauth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setOpen(false);
    setPassword('');
    setError(null);
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: deleteError } = await reauth.run(() => api.auth.deleteUser(password));
    setBusy(false);
    if (deleteError) {
      if (deleteError.code === 'reauth_cancelled') return;
      const messages: Record<string, string> = {
        invalid_credentials: t('deleteAccountWrongPassword'),
        last_admin: t('deleteAccountLastAdmin'),
      };
      setError(messages[deleteError.code ?? ''] ?? mfaErrorMessage(deleteError, t));
      return;
    }
    navigate('/login', { replace: true });
  };

  return (
    <Card className="space-y-3">
      <h2 className="text-base font-medium">{t('deleteAccount')}</h2>
      <p className="text-sm text-text-secondary">{t('deleteAccountHint')}</p>
      <Button variant="accent" onClick={() => setOpen(true)}>
        <Trash2 size={15} />
        {t('deleteAccount')}
      </Button>

      <Modal
        open={open && !reauth.modal}
        title={t('deleteAccount')}
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              {t('cancel')}
            </Button>
            <Button type="submit" form="delete-account-form" variant="accent" disabled={busy || !password}>
              {busy ? t('loading') : t('deleteAccount')}
            </Button>
          </>
        }
      >
        <form id="delete-account-form" onSubmit={confirm} className="space-y-4">
          <p className="text-sm text-text-secondary">{t('deleteAccountConfirm')}</p>
          <Input
            type="password"
            label={t('password')}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
          />
          {error && <p className="text-sm text-accent">{error}</p>}
        </form>
      </Modal>
      {reauth.modal}
    </Card>
  );
};

// Light / dark / system, stored on this device.
const AppearanceCard = () => {
  const { t } = useI18n();
  const { preference, setPreference } = useTheme();
  const options: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: t('themeLight'), icon: Sun },
    { value: 'dark', label: t('themeDark'), icon: Moon },
    { value: 'system', label: t('themeSystem'), icon: Monitor },
  ];
  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-base font-medium">{t('appearance')}</h2>
        <p className="text-sm text-text-secondary mt-1">{t('appearanceHint')}</p>
      </div>
      <div role="radiogroup" aria-label={t('appearance')} className="grid grid-cols-3 gap-2">
        {options.map(({ value, label, icon: Icon }) => {
          const active = preference === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setPreference(value)}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-md border px-3 py-3 text-sm font-medium transition-colors duration-150',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                active
                  ? 'border-black bg-surface-muted text-text'
                  : 'border-border text-text-secondary hover:bg-surface-subtle hover:text-text',
              )}
            >
              <Icon size={18} />
              {label}
            </button>
          );
        })}
      </div>
    </Card>
  );
};

// Email notifications (opt-in); they need the server's SMTP setup.
const NotificationsCard = () => {
  const { t } = useI18n();
  const { user, refreshUser } = useAuth();
  const [mailEnabled, setMailEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    void api.rpc('get_public_config').then(({ data }) =>
      setMailEnabled(Boolean((data as { mail_enabled?: boolean } | null)?.mail_enabled)),
    );
  }, []);

  if (!user || mailEnabled === null) return null;

  const toggles = [
    ['notify_reminders', 'notifyReminders', 'notifyRemindersHint'],
    ['notify_status', 'notifyStatus', 'notifyStatusHint'],
    ['notify_weekly', 'notifyWeekly', 'notifyWeeklyHint'],
  ] as const;

  const toggle = async (key: (typeof toggles)[number][0], value: boolean) => {
    await api.from('app_users').update({ [key]: value }).eq('id', user.id);
    await refreshUser();
  };

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-base font-medium flex items-center gap-2">
          <Bell size={17} className="text-text-secondary" />
          {t('notifications')}
        </h2>
        <p className="text-sm text-text-secondary mt-1">
          {mailEnabled ? t('notificationsHint') : t('notificationsUnavailable')}
        </p>
      </div>
      {toggles.map(([key, label, hint]) => (
        <label
          key={key}
          className={cn(
            'flex items-center justify-between gap-4 border-t border-border pt-4',
            mailEnabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
          )}
        >
          <span>
            <span className="block font-medium">{t(label)}</span>
            <span className="block text-sm text-text-secondary mt-0.5">{t(hint)}</span>
          </span>
          <input
            type="checkbox"
            className="h-4 w-4 flex-shrink-0 accent-black"
            checked={user[key]}
            disabled={!mailEnabled}
            onChange={(e) => void toggle(key, e.target.checked)}
          />
        </label>
      ))}
    </Card>
  );
};

// "Chrome on macOS" from a user agent; good enough to tell devices apart.
const describeDevice = (ua: string | null) => {
  if (!ua) return { label: null, mobile: false };
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  return {
    label: [browser, os].filter(Boolean).join(' · ') || ua.slice(0, 60),
    mobile: /Mobile|iPhone|Android/.test(ua),
  };
};

const SESSIONS_PREVIEW = 5;

// Signed-in devices, with sign-out per device or for all others.
const SessionsCard = () => {
  const { t, lang } = useI18n();
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = async () => {
    const { data } = await api.auth.listSessions();
    setSessions(data?.sessions ?? []);
  };

  useEffect(() => {
    void load();
  }, []);

  const revoke = async (input: { id: string } | { others: true }) => {
    setBusy(true);
    await api.auth.revokeSession(input);
    setBusy(false);
    await load();
  };

  if (!sessions) return null;
  const others = sessions.filter((s) => !s.current).length;
  const when = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })
      : '—';

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-base font-medium">{t('activeSessions')}</h2>
        <p className="text-sm text-text-secondary mt-1">{t('activeSessionsHint')}</p>
      </div>
      <ul className="divide-y divide-border border-t border-border">
        {(showAll ? sessions : sessions.slice(0, SESSIONS_PREVIEW)).map((s) => {
          const device = describeDevice(s.user_agent);
          const Icon = device.mobile ? Smartphone : Laptop;
          return (
            <li key={s.id} className="flex items-center gap-3 py-3">
              <Icon size={18} className="flex-shrink-0 text-text-secondary" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                  {device.label ?? t('unknownDevice')}
                  {s.current && (
                    <span className="rounded-md bg-success-soft-strong px-1.5 py-0.5 text-xs font-semibold text-success-strong">
                      {t('thisDevice')}
                    </span>
                  )}
                </p>
                <p className="text-xs text-text-secondary">
                  {t('lastSeen')}: {when(s.last_seen_at ?? s.created_at)} · {t('signedInAt')}: {when(s.created_at)}
                </p>
              </div>
              {!s.current && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void revoke({ id: s.id })}
                  title={t('signOutDevice')}
                  aria-label={t('signOutDevice')}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-danger-soft hover:text-danger-strong disabled:opacity-50"
                >
                  <LogOut size={15} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {sessions.length > SESSIONS_PREVIEW && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-sm font-medium text-text-secondary hover:text-text"
        >
          {showAll ? t('showLess') : `${t('showMore')} (${sessions.length - SESSIONS_PREVIEW})`}
        </button>
      )}
      {others > 0 && (
        <Button variant="secondary" disabled={busy} onClick={() => void revoke({ others: true })}>
          <LogOut size={15} />
          {t('signOutOtherDevices')} ({others})
        </Button>
      )}
    </Card>
  );
};
