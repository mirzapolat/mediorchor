import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ExternalLink, ImagePlus, RotateCcw, Upload, X } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Textarea } from '@/components/Input';
import { PageSpinner } from '@/components/Spinner';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { api } from '@/lib/api';
import { CardColumns } from '@/components/CardColumns';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { LEGAL_KINDS, LEGAL_PATH, LEGAL_TITLE, refreshLegalPages, type LegalKind } from '@/lib/legalPages';
import { cn } from '@/lib/cn';
import { uploadImage } from '@/lib/uploadImage';
import { PhotoCropper } from '@/components/PhotoCropper';
import { AppLogo } from '@/components/AppLogo';
import { channels as channelsOf } from '@/lib/branding';
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
  brand_defaults: { app_name: string; accent_color: string };
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
      <PageHeader title={t('adminSecurity')} />

      {info ? <BrandingCard defaults={info.brand_defaults} /> : null}

      <CardColumns>
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
      </CardColumns>

      <div className="max-w-5xl space-y-6">
        {LEGAL_KINDS.map((kind) => (
          <LegalPageCard key={kind} kind={kind} />
        ))}
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

type LegalMode = 'none' | 'text' | 'link';

interface LegalSettings {
  mode: LegalMode;
  text: string;
  url: string | null;
}

const LEGAL_COPY: Record<
  LegalKind,
  { hint: TranslationKey; textLabel: TranslationKey; textHint: TranslationKey; placeholder: TranslationKey }
> = {
  imprint: {
    hint: 'imprintHint',
    textLabel: 'imprintTextLabel',
    textHint: 'imprintTextHint',
    placeholder: 'imprintTextPlaceholder',
  },
  privacy: {
    hint: 'privacyHint',
    textLabel: 'privacyTextLabel',
    textHint: 'privacyTextHint',
    placeholder: 'privacyTextPlaceholder',
  },
};

// Imprint (Impressum) or privacy policy (Datenschutzerklärung): own text
// (Markdown, shown at /impressum or /datenschutz) or a link to an external
// page. Linked subtly from the login, registration and check-in pages;
// public, so it lives in the world-readable app_settings.
const LegalPageCard = ({ kind }: { kind: LegalKind }) => {
  const { t } = useI18n();
  const copy = LEGAL_COPY[kind];
  const columns = `${kind}_mode, ${kind}_text, ${kind}_url`;
  const [stored, setStored] = useState<LegalSettings | null>(null);
  const [mode, setMode] = useState<LegalMode>('none');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .from('app_settings')
      .select(columns)
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        const row = (data ?? {}) as Record<string, string | null>;
        const next: LegalSettings = {
          mode: (row[`${kind}_mode`] as LegalMode | null) ?? 'none',
          text: row[`${kind}_text`] ?? '',
          url: row[`${kind}_url`] ?? null,
        };
        setStored(next);
        setMode(next.mode);
        setText(next.text);
        setUrl(next.url ?? '');
      });
  }, [kind, columns]);

  if (!stored) return null;

  const trimmedUrl = url.trim();
  const urlValid = /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(trimmedUrl);
  const dirty = mode !== stored.mode || text !== stored.text || trimmedUrl !== (stored.url ?? '');
  const canSave = dirty && !saving && (mode === 'none' || (mode === 'text' ? Boolean(text.trim()) : urlValid));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const next: LegalSettings = { mode, text, url: trimmedUrl || null };
    const { error: saveError } = await api
      .from('app_settings')
      .update({ [`${kind}_mode`]: next.mode, [`${kind}_text`]: next.text, [`${kind}_url`]: next.url })
      .eq('id', 1);
    setSaving(false);
    if (saveError) {
      setError(saveError.code === 'invalid_legal_url' ? t('legalUrlInvalid') : saveError.message);
      return;
    }
    setStored(next);
    setSaved(true);
    void refreshLegalPages();
  };

  const change = (fn: () => void) => {
    fn();
    setSaved(false);
    setError(null);
  };

  return (
    <form onSubmit={(e) => void save(e)}>
      <Card className="space-y-4">
        <div>
          <h2 className="text-base font-medium">{t(LEGAL_TITLE[kind])}</h2>
          <p className="mt-1 text-sm text-text-secondary">{t(copy.hint)}</p>
        </div>

        <div role="radiogroup" aria-label={t(LEGAL_TITLE[kind])} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(
            [
              ['none', 'legalModeNone'],
              ['text', 'legalModeText'],
              ['link', 'legalModeLink'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => change(() => setMode(value))}
              className={cn(
                'rounded-md border px-3 py-2.5 text-sm font-medium transition-colors duration-150',
                mode === value
                  ? 'border-black bg-surface-subtle'
                  : 'border-border text-text-secondary hover:bg-surface-subtle',
              )}
            >
              {t(label)}
            </button>
          ))}
        </div>

        {mode === 'text' && (
          <MarkdownEditor
            label={t(copy.textLabel)}
            hint={t(copy.textHint)}
            value={text}
            onChange={(value) => change(() => setText(value))}
            placeholder={t(copy.placeholder)}
          />
        )}
        {mode === 'link' && (
          <div className="space-y-1.5">
            <Input
              type="url"
              label={t('legalUrlLabel')}
              value={url}
              onChange={(e) => change(() => setUrl(e.target.value))}
              placeholder={`https://www.example.org${LEGAL_PATH[kind]}`}
            />
            {trimmedUrl && !urlValid ? <p className="text-sm text-danger-strong">{t('legalUrlInvalid')}</p> : null}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button type="submit" disabled={!canSave}>
            {saving ? t('loading') : t('save')}
          </Button>
          {stored.mode === 'text' && !dirty ? (
            <Link
              to={LEGAL_PATH[kind]}
              target="_blank"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text"
            >
              {t('viewLegalPage')}
              <ExternalLink size={14} />
            </Link>
          ) : null}
          {saved && !dirty ? <span className="text-sm text-text-secondary">✓ {t('saved')}</span> : null}
          {error ? <p className="text-sm text-danger-strong">{error}</p> : null}
        </div>
      </Card>
    </form>
  );
};

interface BrandingSettings {
  brand_name: string | null;
  brand_accent: string | null;
  brand_logo_url: string | null;
  brand_logo_invert: boolean;
}

// Instance branding: name, logo (also the favicon) and accent color, applied
// everywhere — sidebar, login, public pages, browser tab, emails. Empty values
// fall back to the environment (VITE_APP_NAME, VITE_ACCENT_COLOR, bundled
// logo). The app reads branding at load, so saving reloads the page.
const BrandingCard = ({ defaults }: { defaults: ServerInfo['brand_defaults'] }) => {
  const { t } = useI18n();
  const [stored, setStored] = useState<BrandingSettings | null>(null);
  const [name, setName] = useState('');
  const [accent, setAccent] = useState<string | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [invert, setInvert] = useState(false);
  const [picked, setPicked] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .from('app_settings')
      .select('brand_name, brand_accent, brand_logo_url, brand_logo_invert')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        const row = (data as BrandingSettings | null) ?? {
          brand_name: null,
          brand_accent: null,
          brand_logo_url: null,
          brand_logo_invert: false,
        };
        setStored(row);
        setName(row.brand_name ?? '');
        setAccent(row.brand_accent);
        setLogo(row.brand_logo_url);
        setInvert(row.brand_logo_invert);
      });
  }, []);

  if (!stored) return null;

  const next: BrandingSettings = {
    brand_name: name.trim() || null,
    brand_accent: accent,
    brand_logo_url: logo,
    brand_logo_invert: logo ? invert : false,
  };
  const saved: BrandingSettings = {
    ...stored,
    brand_logo_invert: stored.brand_logo_url ? stored.brand_logo_invert : false,
  };
  const dirty = JSON.stringify(next) !== JSON.stringify(saved);
  const shownName = next.brand_name ?? defaults.app_name;
  const shownAccent = accent ?? defaults.accent_color;

  const upload = async (file: File) => {
    setPicked(null);
    setUploading(true);
    setError(null);
    const { url, error: uploadError } = await uploadImage('branding', file);
    setUploading(false);
    if (uploadError) setError(uploadError);
    else setLogo(url);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error: saveError } = await api.from('app_settings').update(next).eq('id', 1);
    if (saveError) {
      setSaving(false);
      setError(saveError.message);
      return;
    }
    // Name, logo and accent are read once at page load (and baked into
    // index.html by the server), so reload to show them everywhere.
    window.location.reload();
  };

  return (
    <form onSubmit={(e) => void save(e)} className="mb-6 max-w-5xl">
      <Card className="space-y-5">
        <div>
          <h2 className="text-base font-medium">{t('branding')}</h2>
          <p className="mt-1 text-sm text-text-secondary">{t('brandingHint')}</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-5">
            <Input
              label={t('brandName')}
              value={name}
              maxLength={60}
              placeholder={defaults.app_name}
              onChange={(e) => setName(e.target.value)}
            />

            <div>
              <p className="mb-1.5 text-sm font-medium text-text">{t('brandLogo')}</p>
              <div className="flex items-center gap-4">
                <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-surface-subtle">
                  <AppLogo preview={{ url: logo, invert }} className="h-10 w-10" />
                </span>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-text-secondary transition-colors duration-150 hover:bg-surface-muted">
                    {logo ? <Upload size={15} /> : <ImagePlus size={15} />}
                    {uploading ? t('loading') : logo ? t('replaceImage') : t('uploadImage')}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) setPicked(file);
                      }}
                    />
                  </label>
                  {logo && (
                    <button
                      type="button"
                      onClick={() => setLogo(null)}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text"
                    >
                      <X size={15} />
                      {t('brandLogoDefault')}
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-1.5 text-sm text-text-secondary">{t('brandLogoHint')}</p>
              {logo && (
                <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-black"
                    checked={invert}
                    onChange={(e) => setInvert(e.target.checked)}
                  />
                  {t('brandLogoInvert')}
                </label>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-sm font-medium text-text">{t('brandAccent')}</p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border py-1.5 pl-1.5 pr-3 transition-colors duration-150 hover:bg-surface-muted">
                  <input
                    type="color"
                    value={shownAccent}
                    onChange={(e) => setAccent(e.target.value.toLowerCase())}
                    className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                  />
                  <span className="font-mono text-sm uppercase">{shownAccent}</span>
                </label>
                {accent ? (
                  <button
                    type="button"
                    onClick={() => setAccent(null)}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text"
                  >
                    <RotateCcw size={14} />
                    {t('brandAccentReset')}
                  </button>
                ) : (
                  <span className="text-sm text-text-secondary">{t('brandDefaultValue')}</span>
                )}
              </div>
            </div>
          </div>

          {/* Live preview: sidebar header and an accent button. */}
          <div
            className="space-y-3 rounded-xl border border-border bg-bg p-4"
            style={{ '--c-accent': channelsOf(shownAccent) } as CSSProperties}
          >
            <p className="text-xs font-medium text-text-tertiary">{t('preview')}</p>
            <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5">
              <AppLogo preview={{ url: logo, invert }} className="h-6 w-6" />
              <span className="truncate font-semibold">{shownName}</span>
            </div>
            <Button type="button" variant="accent" className="w-full" tabIndex={-1}>
              {t('brandPreviewButton')}
            </Button>
            <div className="h-1.5 rounded-full bg-accent/20">
              <div className="h-full w-2/3 rounded-full bg-accent" />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button type="submit" disabled={!dirty || saving || uploading}>
            {saving ? t('loading') : t('save')}
          </Button>
          {dirty ? <span className="text-sm text-text-secondary">{t('brandingReloadHint')}</span> : null}
          {error ? <p className="text-sm text-danger-strong">{error}</p> : null}
        </div>
      </Card>
      <PhotoCropper
        file={picked}
        shape="square"
        format="png"
        outputSize={512}
        onCancel={() => setPicked(null)}
        onConfirm={(cropped) => void upload(cropped)}
      />
    </form>
  );
};
