import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Input } from '@/components/Input';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { PageSpinner } from '@/components/Spinner';
import { Checkbox } from '@/components/RegistrationPageForm';
import { WebhookSetup } from '@/components/WebhookSetup';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useProjectContext } from '@/layouts/projectContext';
import type { RegistrationPage } from '@/types';

interface FormState {
  title: string;
  description: string;
  ask_email: boolean;
  ask_group: boolean;
  auto_transfer: boolean;
}

const toForm = (page: RegistrationPage): FormState => ({
  title: page.title,
  description: page.description,
  ask_email: page.ask_email,
  ask_group: page.ask_group,
  auto_transfer: page.auto_transfer,
});

// Settings of one registration page: name, public link, form options,
// auto-transfer and — for webhook sources — the webhook URL, field mapping
// and setup guides.
export const RegistrationPageSettings = () => {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const { pageId } = useParams();
  const navigate = useNavigate();

  const [page, setPage] = useState<RegistrationPage | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchPage = useCallback(async () => {
    const { data } = await api.from('registration_pages').select('*').eq('id', pageId).maybeSingle();
    return (data as RegistrationPage | null) ?? null;
  }, [pageId]);

  useEffect(() => {
    void fetchPage().then((next) => {
      setPage(next);
      setForm(next ? toForm(next) : null);
      setLoading(false);
    });
  }, [fetchPage]);

  // Reloads the page for the webhook section without touching unsaved edits.
  const refresh = async () => {
    const next = await fetchPage();
    if (next) setPage(next);
  };

  if (loading) return <PageSpinner />;
  if (!page || !form) {
    navigate(`/projects/${project.id}/registrations`);
    return null;
  }

  const publicUrl = `${window.location.origin}/register/${page.token}`;
  const webhook = page.source === 'webhook';

  const update = (patch: Partial<FormState>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setSaved(false);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    // Webhook entries bring whatever fields they have, so the list always
    // shows the email and group columns for them.
    const { data } = await api
      .from('registration_pages')
      .update({
        title: form.title.trim(),
        description: webhook ? '' : form.description,
        ask_email: webhook || form.ask_email,
        ask_group: webhook || form.ask_group,
        auto_transfer: form.auto_transfer,
      })
      .eq('id', page.id)
      .select()
      .single();
    if (data) {
      setPage(data as RegistrationPage);
      setForm(toForm(data as RegistrationPage));
    }
    setSaving(false);
    setSaved(true);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <>
      <button
        onClick={() => navigate(`/projects/${project.id}/registrations/${page.id}`)}
        className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text"
      >
        <ArrowLeft size={16} />
        {page.title}
      </button>

      <PageHeader title={t('settings')} />

      <form onSubmit={save} className="mb-6">
        <Card className="space-y-4">
          {!webhook && (
            <div className="border-b border-border pb-4">
              <p className="text-sm text-text-secondary">{t('registrationLinkHint')}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="max-w-full truncate text-sm text-text-tertiary underline underline-offset-2 hover:text-text"
                >
                  {publicUrl}
                </a>
                <Button type="button" variant="secondary" onClick={copyLink}>
                  <Copy size={15} />
                  {copied ? t('linkCopied') : t('copyCheckInLink')}
                </Button>
              </div>
            </div>
          )}

          <Input
            label={t('registrationTitle')}
            value={form.title}
            onChange={(e) => update({ title: e.target.value })}
            required
          />

          {!webhook && (
            <>
              <MarkdownEditor
                label={t('registrationDescription')}
                hint={t('registrationDescriptionHint')}
                value={form.description}
                onChange={(value) => update({ description: value })}
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Checkbox
                  checked={form.ask_email}
                  onChange={(v) => update({ ask_email: v })}
                  label={t('askEmail')}
                />
                <Checkbox
                  checked={form.ask_group}
                  onChange={(v) => update({ ask_group: v })}
                  label={t('askGroup')}
                  hint={t('askGroupProjectHint')}
                />
              </div>
            </>
          )}

          <Checkbox
            checked={form.auto_transfer}
            onChange={(v) => update({ auto_transfer: v })}
            label={t('autoTransfer')}
            hint={
              webhook ? `${t('autoTransferHint')} ${t('webhookAutoTransferNote')}` : t('autoTransferHint')
            }
          />

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving || !form.title.trim()}>
              {saving ? t('loading') : t('save')}
            </Button>
            {saved && <span className="text-sm text-text-secondary">✓</span>}
          </div>
        </Card>
      </form>

      {webhook && <WebhookSetup page={page} onChange={setPage} onRefresh={() => void refresh()} />}
    </>
  );
};
