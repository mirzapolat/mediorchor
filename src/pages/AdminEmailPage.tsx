import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { CheckCircle2, Lock, PlugZap, Send, Trash2, TriangleAlert, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { MailStatsCard } from '@/components/MailStatsCard';
import { PageSpinner } from '@/components/Spinner';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { api, type ApiError } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

type Security = 'tls' | 'starttls' | 'none';

interface SmtpValues {
  host: string;
  port: number;
  security: Security | 'auto';
  username: string | null;
  has_password: boolean;
  from_address: string;
  from_name: string | null;
}

interface SmtpStatus {
  source: 'settings' | 'environment' | null;
  settings: (SmtpValues & { password_unreadable: boolean; updated_at: string }) | null;
  environment: SmtpValues | null;
}

interface Form {
  host: string;
  port: string;
  security: Security;
  username: string;
  // New password; empty = keep the stored one (unless clearPassword).
  password: string;
  clearPassword: boolean;
  from_address: string;
  from_name: string;
}

const DEFAULT_PORT: Record<Security, number> = { tls: 465, starttls: 587, none: 25 };

const toForm = (v: SmtpValues | null): Form => ({
  host: v?.host ?? '',
  port: String(v?.port ?? 587),
  // The environment's "STARTTLS when offered" is saved as required STARTTLS.
  security: !v || v.security === 'auto' ? 'starttls' : v.security,
  username: v?.username ?? '',
  password: '',
  clearPassword: false,
  from_address: v?.from_address ?? '',
  from_name: v?.from_name ?? '',
});

const ERROR_KEYS: Record<string, TranslationKey> = {
  smtp_password_reentry: 'smtpPasswordReentry',
  smtp_insecure_auth: 'smtpInsecureAuth',
  over_request_rate_limit: 'smtpTooManyTests',
};

// Admin → Email: the outgoing mail server. The password is write-only — the
// server stores it encrypted and only reports whether one is set.
export const AdminEmailPage = () => {
  const { t } = useI18n();
  const { isAdmin, user } = useAuth();
  const [status, setStatus] = useState<SmtpStatus | null>(null);
  const [form, setForm] = useState<Form>(toForm(null));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState<'verify' | 'send' | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = (next: SmtpStatus) => {
    setStatus(next);
    setForm(toForm(next.settings ?? next.environment));
  };

  useEffect(() => {
    void api.functions.invoke('admin-smtp-get').then(({ data }) => {
      if (data) load(data as SmtpStatus);
    });
  }, []);

  useEffect(() => {
    if (user?.email) setTestTo((current) => current || user.email);
  }, [user?.email]);

  if (!isAdmin) return <Navigate to="/" replace />;
  if (!status) return <PageSpinner />;

  const current = status.settings ?? status.environment;
  const hasStoredPassword = Boolean(current?.has_password);
  // The stored password is only reused for the same server and user.
  const passwordReusable =
    hasStoredPassword &&
    form.host.trim().toLowerCase() === current?.host.toLowerCase() &&
    form.username.trim() === (current?.username ?? '');

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setNotice(null);
    setTestResult(null);
  };

  const changeSecurity = (security: Security) => {
    setForm((f) => ({
      ...f,
      security,
      // Follow the usual port unless a custom one was entered.
      port: Object.values(DEFAULT_PORT).includes(Number(f.port)) ? String(DEFAULT_PORT[security]) : f.port,
    }));
    setTestResult(null);
  };

  const payload = () => ({
    host: form.host.trim(),
    port: Number(form.port),
    security: form.security,
    username: form.username.trim() || null,
    // undefined = keep the stored password, null = none.
    password: form.clearPassword || !form.username.trim() ? null : form.password || undefined,
    from_address: form.from_address.trim(),
    from_name: form.from_name.trim() || null,
  });

  const errorText = (error: ApiError) => (error.code && ERROR_KEYS[error.code] ? t(ERROR_KEYS[error.code]) : error.message);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    const { data, error } = await api.functions.invoke('admin-smtp-save', { body: payload() });
    setSaving(false);
    if (error) {
      setNotice({ ok: false, message: errorText(error) });
      return;
    }
    load(data as SmtpStatus);
    setNotice({ ok: true, message: t('saved') });
  };

  const test = async (send: boolean) => {
    setTesting(send ? 'send' : 'verify');
    setTestResult(null);
    const { data, error } = await api.functions.invoke('admin-smtp-test', {
      body: { ...payload(), send, to: testTo.trim() },
    });
    setTesting(null);
    if (error) {
      setTestResult({ ok: false, message: `${t('smtpTestFailed')} ${errorText(error)}` });
      return;
    }
    const to = (data as { to: string | null }).to;
    setTestResult({ ok: true, message: to ? t('testMailSent').replace('{to}', to) : t('smtpConnectionOk') });
  };

  const remove = async () => {
    setConfirmRemove(false);
    const { data, error } = await api.functions.invoke('admin-smtp-delete');
    if (error) {
      setNotice({ ok: false, message: errorText(error) });
      return;
    }
    load(data as SmtpStatus);
    setNotice({ ok: true, message: t('smtpRemoved') });
  };

  const complete = form.host.trim() && form.port.trim() && form.from_address.trim();
  const busy = saving || testing !== null;

  return (
    <>
      <PageHeader title={t('emailSection')} />

      <div className="grid max-w-5xl gap-6 lg:grid-cols-[3fr_2fr] lg:items-start">
        <Card>
          <form className="space-y-4" onSubmit={(e) => void save(e)} autoComplete="off">
            <StatusLine status={status} />

            <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-[1fr_120px]">
              <Input
                label={t('mailServer')}
                value={form.host}
                onChange={(e) => set('host', e.target.value)}
                placeholder="smtp.example.org"
                autoComplete="off"
                spellCheck={false}
                required
              />
              <Input
                type="number"
                label={t('smtpPort')}
                min={1}
                max={65535}
                value={form.port}
                onChange={(e) => set('port', e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Select
                label={t('smtpSecurity')}
                value={form.security}
                onChange={(e) => changeSecurity(e.target.value as Security)}
              >
                <option value="starttls">{t('smtpSecurityStarttls')}</option>
                <option value="tls">{t('smtpSecurityTls')}</option>
                <option value="none">{t('smtpSecurityNone')}</option>
              </Select>
              {form.security === 'none' && (
                <p className="flex items-start gap-1.5 text-sm text-danger-strong">
                  <TriangleAlert size={15} className="mt-0.5 flex-shrink-0" />
                  {t('smtpSecurityNoneHint')}
                </p>
              )}
            </div>

            <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
              <Input
                label={t('mailUser')}
                value={form.username}
                onChange={(e) => set('username', e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <div className="space-y-1.5">
                <Input
                  type="password"
                  label={t('password')}
                  value={form.password}
                  onChange={(e) => {
                    set('password', e.target.value);
                    if (e.target.value) set('clearPassword', false);
                  }}
                  // Keeps browsers from filling in the admin's own login.
                  autoComplete="new-password"
                  disabled={!form.username.trim()}
                  placeholder={passwordReusable && !form.clearPassword ? t('smtpPasswordKeep') : ''}
                />
                {passwordReusable && !form.password && (
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-black"
                      checked={form.clearPassword}
                      onChange={(e) => set('clearPassword', e.target.checked)}
                    />
                    {t('smtpPasswordRemove')}
                  </label>
                )}
              </div>
            </div>
            <p className="flex items-start gap-1.5 text-sm text-text-secondary">
              <Lock size={14} className="mt-0.5 flex-shrink-0" />
              {t('smtpPasswordHint')}
            </p>
            {status.settings?.password_unreadable && (
              <p className="text-sm text-danger-strong">{t('smtpPasswordUnreadable')}</p>
            )}

            <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
              <Input
                type="email"
                label={t('smtpFromAddress')}
                value={form.from_address}
                onChange={(e) => set('from_address', e.target.value)}
                placeholder="noreply@example.org"
                required
              />
              <Input
                label={t('smtpFromName')}
                value={form.from_name}
                onChange={(e) => set('from_name', e.target.value)}
                maxLength={120}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <Button type="submit" disabled={busy || !complete}>
                {saving ? t('loading') : t('save')}
              </Button>
              {status.source === 'settings' && (
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirmRemove(true)}>
                  <Trash2 size={15} />
                  {t('smtpRemove')}
                </Button>
              )}
              {notice && (
                <p className={`text-sm ${notice.ok ? 'text-text-secondary' : 'text-danger-strong'}`}>
                  {notice.ok ? `✓ ${notice.message}` : notice.message}
                </p>
              )}
            </div>
          </form>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-base font-medium">{t('smtpTestSection')}</h2>
          <p className="text-sm text-text-secondary">{t('smtpTestHint')}</p>
          <Button
            variant="secondary"
            disabled={busy || !complete}
            onClick={() => void test(false)}
            className="w-full sm:w-auto"
          >
            <PlugZap size={15} />
            {testing === 'verify' ? t('loading') : t('smtpCheckConnection')}
          </Button>
          <div className="space-y-2 border-t border-border pt-4">
            <Input
              type="email"
              label={t('testMailTo')}
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
            />
            <Button variant="secondary" disabled={busy || !complete || !testTo.trim()} onClick={() => void test(true)}>
              <Send size={15} />
              {testing === 'send' ? t('loading') : t('sendTestMail')}
            </Button>
          </div>
          {testResult && (
            <p
              role="status"
              className={`break-words text-sm ${testResult.ok ? 'text-success-strong' : 'text-danger-strong'}`}
            >
              {testResult.message}
            </p>
          )}
        </Card>
      </div>

      <div className="mt-6 max-w-5xl">
        <MailStatsCard />
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title={t('smtpRemove')}
        message={status.environment ? t('smtpRemoveConfirmEnv') : t('smtpRemoveConfirm')}
        confirmLabel={t('smtpRemove')}
        destructive
        onConfirm={() => void remove()}
        onCancel={() => setConfirmRemove(false)}
      />
    </>
  );
};

const StatusLine = ({ status }: { status: SmtpStatus }) => {
  const { t } = useI18n();
  const configured = status.source !== null;
  return (
    <div className="space-y-1">
      <p
        className={`inline-flex items-center gap-2 text-sm font-medium ${
          configured ? 'text-success-strong' : 'text-text-secondary'
        }`}
      >
        {configured ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
        {configured ? t('mailConfigured') : t('mailNotConfigured')}
      </p>
      <p className="text-sm text-text-secondary">
        {status.source === 'settings'
          ? t('smtpSourceSettings')
          : status.source === 'environment'
            ? t('smtpSourceEnvironment')
            : t('mailNotConfiguredHint')}
      </p>
    </div>
  );
};
