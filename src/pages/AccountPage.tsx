import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Monitor, Moon, ShieldCheck, ShieldOff, Sun, Trash2, Upload, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Avatar } from '@/components/Avatar';
import { PageSpinner } from '@/components/Spinner';
import { Modal } from '@/components/Modal';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
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
            <Select value={lang} onChange={(e) => setLang(e.target.value as Language)} className="max-w-[200px]">
              <option value="en">English</option>
              <option value="de">Deutsch</option>
            </Select>
          </Card>

          <AppearanceCard />

          <TwoFactorCard />

          <DeleteAccountCard />
        </div>
      </div>
      {photo.cropper}
    </>
  );
};

// 2FA enrolment (TOTP). Once verified, sign-in asks for a code.
const TwoFactorCard = () => {
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
  };

  const disable = async () => {
    const { data } = await api.auth.mfa.listFactors();
    const totp = data?.totp?.[0];
    if (totp) await api.auth.mfa.unenroll({ factorId: totp.id });
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
        <Button variant="secondary" onClick={disable}>
          {t('disable2fa')}
        </Button>
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
            label="123456"
            inputMode="numeric"
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
