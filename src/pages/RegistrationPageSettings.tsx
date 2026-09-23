import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, Pencil } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { PageSpinner } from '@/components/Spinner';
import { RegistrationPageForm } from '@/components/RegistrationPageForm';
import { WebhookSetup } from '@/components/WebhookSetup';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useProjectContext } from '@/layouts/projectContext';
import type { RegistrationPage } from '@/types';

// Settings of one registration page: public link, auto-transfer and — for
// webhook sources — the webhook URL, field mapping and setup guides.
export const RegistrationPageSettings = () => {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const { pageId } = useParams();
  const navigate = useNavigate();

  const [page, setPage] = useState<RegistrationPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.from('registration_pages').select('*').eq('id', pageId).maybeSingle();
    setPage((data as RegistrationPage | null) ?? null);
    setLoading(false);
  }, [pageId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <PageSpinner />;
  if (!page) {
    navigate(`/projects/${project.id}/registrations`);
    return null;
  }

  const publicUrl = `${window.location.origin}/register/${page.token}`;

  const toggleAutoTransfer = async () => {
    setBusy(true);
    const { data } = await api
      .from('registration_pages')
      .update({ auto_transfer: !page.auto_transfer })
      .eq('id', page.id)
      .select()
      .single();
    if (data) setPage(data as RegistrationPage);
    setBusy(false);
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

      <PageHeader
        title={t('settings')}
        actions={
          <Button variant="secondary" onClick={() => setFormOpen(true)}>
            <Pencil size={16} />
            {t('edit')}
          </Button>
        }
      />

      <Card className="mb-6 p-5 space-y-4">
        {page.source === 'form' && (
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
              <Button variant="secondary" onClick={copyLink}>
                <Copy size={15} />
                {copied ? t('linkCopied') : t('copyCheckInLink')}
              </Button>
            </div>
          </div>
        )}

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={page.auto_transfer}
            disabled={busy}
            onChange={toggleAutoTransfer}
            className="mt-0.5 accent-black"
          />
          <span>
            <span className="block text-sm font-medium">{t('autoTransfer')}</span>
            <span className="mt-0.5 block text-sm text-text-secondary">
              {t('autoTransferHint')}
              {page.source === 'webhook' && ` ${t('webhookAutoTransferNote')}`}
            </span>
          </span>
        </label>
      </Card>

      {page.source === 'webhook' && (
        <WebhookSetup page={page} onChange={setPage} onRefresh={() => void load()} />
      )}

      <RegistrationPageForm
        open={formOpen}
        projectId={project.id}
        page={page}
        onClose={() => setFormOpen(false)}
        onSaved={load}
      />
    </>
  );
};
