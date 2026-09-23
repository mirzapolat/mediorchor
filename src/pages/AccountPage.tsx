import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Laptop, LogOut, Monitor, Moon, ShieldCheck, ShieldOff, Smartphone, Sun, Trash2, Upload, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Avatar } from '@/components/Avatar';
import { PageSpinner } from '@/components/Spinner';
import { Modal } from '@/components/Modal';
import { useI18n } from '@/lib/i18n';
import { api, type DeviceSession } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useProfilePhoto } from '@/hooks/useProfilePhoto';
import type { Language } from '@/lib/config';
import { useTheme, type ThemePreference } from '@/lib/theme';
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
      const { data, error } = await api.auth.updateUser(authUpdate);
      if (error) {
        setProfileMsg(error.message);
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

      <div className="grid gap-6 max-w-5xl lg:grid-cols-2 lg:items-start">
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

        <div className="space-y-6">
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
        </div>
      </div>
      {photo.cropper}
    </>
  );
};

// 2FA enrolment (TOTP). Once verified, sign-in asks for a code.
// Also used by the required-2FA setup screen (onEnabled continues from there).
export const TwoFactorCard = ({ onEnabled }: { onEnabled?: () => void } = {}) => {
  const { t } = useI18n();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrolled, setEnrolled] = useState(false);
  // otpauth:// URI for the authenticator app, shown as a QR code.
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const { data } = await api.auth.mfa.listFactors();
    const totp = data?.totp?.[0];
    setEnrolled(Boolean(totp && totp.status === 'verified'));
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const startEnroll = async () => {
    setError(null);
    const { data, error } = await api.auth.mfa.enroll({ factorType: 'totp' });
    if (error || !data) {
      setError(error?.message ?? null);
      return;
    }
    setFactorId(data.id);
    setQr(data.totp.uri);
  };

  const verify = async () => {
    if (!factorId) return;
    setError(null);
    const { error } = await api.auth.mfa.verify({ factorId, code });
    if (error) {
      setError(error.message);
      return;
    }
    setQr(null);
    setCode('');
    await refresh();
    onEnabled?.();
  };

  // Disabling asks for a current code (checked by the server).
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [disableError, setDisableError] = useState<string | null>(null);
  const [disabling, setDisabling] = useState(false);

  const closeDisable = () => {
    setDisableOpen(false);
    setDisableCode('');
    setDisableError(null);
  };

  const disable = async (e: FormEvent) => {
    e.preventDefault();
    setDisabling(true);
    setDisableError(null);
    const { data } = await api.auth.mfa.listFactors();
    const totp = data?.totp?.find((f) => f.status === 'verified');
    const { error } = totp
      ? await api.auth.mfa.unenroll({ factorId: totp.id, code: disableCode })
      : { error: null };
    setDisabling(false);
    if (error) {
      setDisableError(
        error.code === 'mfa_verification_failed' || error.code === 'mfa_required'
          ? t('disable2faWrongCode')
          : error.code === 'mfa_enforced'
            ? t('disable2faEnforced')
            : error.message,
      );
      setDisableCode('');
      return;
    }
    closeDisable();
    await refresh();
  };

  if (loading) return null;

  return (
    <Card className="space-y-4">
      <h2 className="text-base font-medium flex items-center gap-2">
        {enrolled ? (
          <ShieldCheck size={18} className="text-accent" />
        ) : (
          <ShieldOff size={18} className="text-text-secondary" />
        )}
        {t('twoFactor')}
      </h2>

      {enrolled ? (
        <>
          <Button variant="secondary" onClick={() => setDisableOpen(true)}>
            {t('disable2fa')}
          </Button>
          <Modal
            open={disableOpen}
            title={t('disable2fa')}
            onClose={closeDisable}
            footer={
              <>
                <Button variant="secondary" onClick={closeDisable}>
                  {t('cancel')}
                </Button>
                <Button
                  type="submit"
                  form="disable-2fa-form"
                  disabled={disabling || disableCode.length < 6}
                >
                  {disabling ? t('loading') : t('disable2fa')}
                </Button>
              </>
            }
          >
            <form id="disable-2fa-form" onSubmit={disable} className="space-y-4">
              <p className="text-sm text-text-secondary">{t('disable2faConfirm')}</p>
              <Input
                label={t('twoFactorCode')}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                maxLength={6}
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))}
                className="max-w-[160px] tracking-widest"
                autoFocus
                required
              />
              {disableError && <p className="text-sm text-danger-strong">{disableError}</p>}
            </form>
          </Modal>
        </>
      ) : qr ? (
        <div className="space-y-4">
          <QRCodeSVG
            value={qr}
            size={176}
            marginSize={2}
            title="TOTP QR"
            className="border border-border rounded-md bg-paper"
          />
          <Input
            label={t('twoFactorCode')}
            placeholder="123456"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="max-w-[160px]"
          />
          {error && <p className="text-sm text-accent">{error}</p>}
          <Button onClick={verify} disabled={code.length < 6}>
            {t('confirm')}
          </Button>
        </div>
      ) : (
        <>
          <Button variant="secondary" onClick={startEnroll}>
            {t('enable2fa')}
          </Button>
          {error && <p className="text-sm text-accent">{error}</p>}
        </>
      )}
    </Card>
  );
};

// Permanently deletes the own account after re-entering the password.
const DeleteAccountCard = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  // Accounts with verified 2FA must also enter a current code.
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openDialog = async () => {
    setOpen(true);
    const { data } = await api.auth.mfa.listFactors();
    setNeedsCode(Boolean(data?.totp?.some((f) => f.status === 'verified')));
  };

  const close = () => {
    setOpen(false);
    setPassword('');
    setCode('');
    setError(null);
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: deleteError } = await api.auth.deleteUser(password, needsCode ? code : undefined);
    setBusy(false);
    if (deleteError) {
      if (deleteError.code === 'mfa_required') setNeedsCode(true);
      const messages: Record<string, string> = {
        invalid_credentials: t('deleteAccountWrongPassword'),
        last_admin: t('deleteAccountLastAdmin'),
        mfa_required: t('deleteAccountConfirm2fa'),
        mfa_verification_failed: t('deleteAccountWrongCode'),
      };
      setError(messages[deleteError.code ?? ''] ?? deleteError.message);
      return;
    }
    navigate('/login', { replace: true });
  };

  return (
    <Card className="space-y-3">
      <h2 className="text-base font-medium">{t('deleteAccount')}</h2>
      <p className="text-sm text-text-secondary">{t('deleteAccountHint')}</p>
      <Button variant="accent" onClick={openDialog}>
        <Trash2 size={15} />
        {t('deleteAccount')}
      </Button>

      <Modal
        open={open}
        title={t('deleteAccount')}
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              {t('cancel')}
            </Button>
            <Button type="submit" form="delete-account-form" variant="accent" disabled={busy || !password || (needsCode && code.trim().length < 6)}>
              {busy ? t('loading') : t('deleteAccount')}
            </Button>
          </>
        }
      >
        <form id="delete-account-form" onSubmit={confirm} className="space-y-4">
          <p className="text-sm text-text-secondary">
            {needsCode ? t('deleteAccountConfirm2fa') : t('deleteAccountConfirm')}
          </p>
          <Input
            type="password"
            label={t('password')}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
          />
          {needsCode && (
            <Input
              label={t('deleteAccountCode')}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="max-w-[160px] tracking-widest"
              required
            />
          )}
          {error && <p className="text-sm text-accent">{error}</p>}
        </form>
      </Modal>
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
