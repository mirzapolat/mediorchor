import { useEffect, useState, type FormEvent } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { PageSpinner } from '@/components/Spinner';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import type { Language } from '@/lib/config';

export const AccountPage = () => {
  const { t, lang, setLang } = useI18n();
  const { user, session, refreshUser } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(session?.user.email ?? '');
  const [password, setPassword] = useState('');
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user) return <PageSpinner />;

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProfileMsg(null);
    await supabase.from('app_users').update({ name: name.trim() }).eq('id', user.id);
    const authUpdate: { email?: string; password?: string } = {};
    if (email && email !== session?.user.email) authUpdate.email = email;
    if (password) authUpdate.password = password;
    if (Object.keys(authUpdate).length > 0) {
      const { error } = await supabase.auth.updateUser(authUpdate);
      if (error) {
        setProfileMsg(error.message);
        setBusy(false);
        return;
      }
    }
    await refreshUser();
    setPassword('');
    setProfileMsg('✓');
    setBusy(false);
  };

  return (
    <>
      <PageHeader title={t('account')} subtitle={user.email} />

      <div className="space-y-6 max-w-xl">
        <form onSubmit={saveProfile}>
          <Card className="space-y-4">
            <h2 className="text-base font-medium">{t('account')}</h2>
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
          <Select value={lang} onChange={(e) => setLang(e.target.value as Language)} className="max-w-[200px]">
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </Select>
        </Card>

        <TwoFactorCard />
      </div>
    </>
  );
};

// 2FA enrolment via Supabase TOTP MFA.
const TwoFactorCard = () => {
  const { t } = useI18n();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrolled, setEnrolled] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    const totp = data?.totp?.[0];
    setEnrolled(Boolean(totp && totp.status === 'verified'));
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const startEnroll = async () => {
    setError(null);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
    if (error) {
      setError(error.message);
      return;
    }
    setFactorId(data.id);
    setQr(data.totp.qr_code);
  };

  const verify = async () => {
    if (!factorId) return;
    setError(null);
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error) {
      setError(challenge.error.message);
      return;
    }
    const { error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code,
    });
    if (error) {
      setError(error.message);
      return;
    }
    setQr(null);
    setCode('');
    await refresh();
  };

  const disable = async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    const totp = data?.totp?.[0];
    if (totp) await supabase.auth.mfa.unenroll({ factorId: totp.id });
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
          <img src={qr} alt="TOTP QR" className="h-44 w-44 border border-border rounded-md" />
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
