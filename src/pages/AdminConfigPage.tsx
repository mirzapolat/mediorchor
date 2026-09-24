import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Textarea } from '@/components/Input';
import { PageSpinner } from '@/components/Spinner';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

interface Settings {
  allow_self_signup: boolean;
  signup_requires_approval: boolean;
  signup_allowed_domains: string;
  require_admin_2fa: boolean;
  session_days: number | null;
}

interface ServerInfo {
  session_days_default: number;
}

// Instance-wide configuration (app_settings singleton) plus server facts.
// Email (SMTP) has its own page: AdminEmailPage.
export const AdminConfigPage = () => {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [domains, setDomains] = useState('');
  const [sessionDays, setSessionDays] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<{ section: string; message: string } | null>(null);

  useEffect(() => {
    Promise.all([
      api
        .from('app_settings')
        .select(
          'allow_self_signup, signup_requires_approval, signup_allowed_domains, require_admin_2fa, session_days',
        )
        .eq('id', 1)
        .maybeSingle(),
      api.functions.invoke('admin-server-info'),
    ]).then(([s, i]) => {
      const row = s.data as Settings | null;
      setSettings(row);
      setDomains(row?.signup_allowed_domains ?? '');
      setSessionDays(row?.session_days != null ? String(row.session_days) : '');
      setInfo((i.data as ServerInfo | null) ?? null);
    });
  }, []);

  if (!isAdmin) return <Navigate to="/" replace />;
  if (!settings) return <PageSpinner />;

  const update = async (section: string, patch: Partial<Settings>) => {
    setError(null);
    setSaved(null);
    const { error: updateError } = await api.from('app_settings').update(patch).eq('id', 1);
    if (updateError) {
      setError({
        section,
        message: updateError.code === 'mfa_self_required' ? t('require2faSelfFirst') : updateError.message,
      });
      return false;
    }
    setSettings({ ...settings, ...patch });
    setSaved(section);
    return true;
  };

  return (
    <>
      <PageHeader title={t('configuration')} />

      <div className="grid max-w-5xl gap-6 lg:grid-cols-2 lg:items-start">
        <Card className="space-y-4">
          <h2 className="text-base font-medium">{t('signupSection')}</h2>
          <ToggleRow
            label={t('allowSelfSignup')}
            hint={t('allowSelfSignupHint')}
            checked={settings.allow_self_signup}
            onChange={(v) => void update('signup', { allow_self_signup: v })}
          />
          <ToggleRow
            label={t('signupApproval')}
            hint={t('signupApprovalHint')}
            checked={settings.signup_requires_approval}
            disabled={!settings.allow_self_signup}
            onChange={(v) => void update('signup', { signup_requires_approval: v })}
          />
          <div className="space-y-2 border-t border-border pt-4">
            <Textarea
              label={t('signupDomains')}
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="verein.de, example.org"
              rows={2}
              disabled={!settings.allow_self_signup}
            />
            <p className="text-sm text-text-secondary">{t('signupDomainsHint')}</p>
            <SaveRow
              visible={domains.trim() !== settings.signup_allowed_domains.trim()}
              onSave={() => void update('domains', { signup_allowed_domains: domains.trim() })}
              saved={saved === 'domains'}
            />
          </div>
          {error?.section === 'signup' || error?.section === 'domains' ? (
            <p className="text-sm text-danger-strong">{error.message}</p>
          ) : null}
        </Card>

        <Card className="space-y-4">
          <h2 className="text-base font-medium">{t('securitySection')}</h2>
          <ToggleRow
            label={t('require2fa')}
            hint={t('require2faHint')}
            checked={settings.require_admin_2fa}
            onChange={(v) => void update('security', { require_admin_2fa: v })}
          />
          <div className="space-y-2 border-t border-border pt-4">
            <Input
              type="number"
              min={1}
              max={365}
              label={t('sessionLength')}
              value={sessionDays}
              onChange={(e) => setSessionDays(e.target.value)}
              placeholder={info ? String(info.session_days_default) : ''}
              className="max-w-[140px]"
            />
            <p className="text-sm text-text-secondary">
              {t('sessionLengthHint').replace('{n}', String(info?.session_days_default ?? 30))}
            </p>
            <SaveRow
              visible={sessionDays.trim() !== (settings.session_days != null ? String(settings.session_days) : '')}
              onSave={() =>
                void update('session', {
                  session_days: sessionDays.trim() ? Math.round(Number(sessionDays)) : null,
                })
              }
              saved={saved === 'session'}
            />
          </div>
          {error?.section === 'security' || error?.section === 'session' ? (
            <p className="text-sm text-danger-strong">{error.message}</p>
          ) : null}
        </Card>
      </div>
    </>
  );
};

const ToggleRow = ({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) => (
  <label
    className={`flex items-center justify-between gap-4 border-t border-border pt-4 first-of-type:border-t-0 ${
      disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
    }`}
  >
    <span>
      <span className="block font-medium">{label}</span>
      <span className="block text-sm text-text-secondary mt-0.5">{hint}</span>
    </span>
    <input
      type="checkbox"
      className="h-4 w-4 flex-shrink-0 accent-black"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  </label>
);

const SaveRow = ({ visible, saved, onSave }: { visible: boolean; saved: boolean; onSave: () => void }) => {
  const { t } = useI18n();
  if (!visible) return saved ? <p className="text-sm text-text-secondary">✓ {t('saved')}</p> : null;
  return (
    <Button onClick={onSave} className="h-9">
      {t('save')}
    </Button>
  );
};
