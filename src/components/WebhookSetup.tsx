import { Fragment, useState } from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { Button } from './Button';
import { Card } from './Card';
import { Select } from './Input';
import { ConfirmDialog } from './ConfirmDialog';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { WEBHOOK_GUIDES } from '@/lib/webhookGuides';
import type { RegistrationPage, WebhookMapping, WebhookTarget } from '@/types';

const TARGETS: { target: WebhookTarget; label: 'firstName' | 'lastName' | 'fullNameField' | 'email' | 'group' }[] = [
  { target: 'first_name', label: 'firstName' },
  { target: 'last_name', label: 'lastName' },
  { target: 'full_name', label: 'fullNameField' },
  { target: 'email', label: 'email' },
  { target: 'group_name', label: 'group' },
];

const AUTO = '';

// Renders `backticks` as inline code.
const RichText = ({ text }: { text: string }) => (
  <>
    {text.split('`').map((part, i) =>
      i % 2 === 1 ? (
        <code key={i} className="rounded bg-[#f5f5f5] px-1 py-0.5 font-mono text-[0.85em]">
          {part}
        </code>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    )}
  </>
);

const useCopy = () => {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 2500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return { copied, copy };
};

// Setup, diagnostics and field mapping for a registration page that receives
// its entries through a webhook.
export const WebhookSetup = ({
  page,
  onChange,
  onRefresh,
}: {
  page: RegistrationPage;
  onChange: (page: RegistrationPage) => void;
  onRefresh: () => void;
}) => {
  const { t, lang } = useI18n();
  const { copied, copy } = useCopy();
  const [guideId, setGuideId] = useState(WEBHOOK_GUIDES[0].id);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [busy, setBusy] = useState(false);

  const url = `${window.location.origin}/api/webhooks/registrations/${page.token}`;
  const guide = WEBHOOK_GUIDES.find((g) => g.id === guideId) ?? WEBHOOK_GUIDES[0];
  const delivery = page.webhook_last_payload;
  const fieldNames = Object.keys(delivery?.fields ?? {});

  const update = async (patch: Partial<RegistrationPage>) => {
    setBusy(true);
    const { data } = await api
      .from('registration_pages')
      .update(patch)
      .eq('id', page.id)
      .select()
      .single();
    if (data) onChange(data as RegistrationPage);
    setBusy(false);
  };

  const regenerate = async () => {
    setConfirmRegenerate(false);
    await update({ token: crypto.randomUUID() });
  };

  const setMapping = (target: WebhookTarget, field: string) => {
    const next: WebhookMapping = { ...page.webhook_mapping };
    if (field === AUTO) delete next[target];
    else next[target] = field;
    void update({ webhook_mapping: next });
  };

  const statusLabel = (status: string | null) => {
    const key = `webhookStatus_${status}` as Parameters<typeof t>[0];
    const label = t(key);
    return label === key ? (status ?? '') : label;
  };

  const dateFormatter = new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  });

  return (
    <div className="mb-6 grid gap-6 lg:grid-cols-2 lg:items-start">
      <div className="space-y-6">
        <Card className="space-y-3">
          <div>
            <h2 className="text-base font-medium">{t('webhookUrl')}</h2>
            <p className="mt-1 text-sm text-text-secondary">{t('webhookUrlHint')}</p>
          </div>
          <code className="block break-all rounded-md border border-border bg-[#fafafa] px-3 py-2 font-mono text-sm">
            {url}
          </code>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => copy('url', url)}>
              {copied === 'url' ? <Check size={15} /> : <Copy size={15} />}
              {copied === 'url' ? t('linkCopied') : t('copyCheckInLink')}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmRegenerate(true)}>
              <RefreshCw size={15} />
              {t('regenerateUrl')}
            </Button>
          </div>
        </Card>

        <Card className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-medium">{t('webhookLastDelivery')}</h2>
              {page.webhook_last_received_at && (
                <p className="mt-1 text-sm text-text-secondary">
                  {dateFormatter.format(new Date(page.webhook_last_received_at))} ·{' '}
                  <span
                    className={cn(
                      'font-medium',
                      page.webhook_last_status === 'ok' ? 'text-[#16803b]' : 'text-accent',
                    )}
                  >
                    {statusLabel(page.webhook_last_status)}
                  </span>
                </p>
              )}
            </div>
            <Button variant="secondary" onClick={onRefresh} aria-label="Refresh">
              <RefreshCw size={15} />
            </Button>
          </div>
          {delivery && fieldNames.length > 0 ? (
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-[#f5f5f5] text-text-secondary">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">{t('webhookField')}</th>
                    <th className="px-3 py-1.5 text-left font-medium">{t('webhookValue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {fieldNames.map((name) => {
                    const target = TARGETS.find((x) => delivery.matched[x.target] === name);
                    return (
                      <tr key={name} className="border-t border-border align-top">
                        <td className="px-3 py-1.5 font-mono text-xs">
                          {name}
                          {target && (
                            <span className="ml-2 font-sans text-xs text-accent">→ {t(target.label)}</span>
                          )}
                        </td>
                        <td className="break-all px-3 py-1.5 text-text-secondary">
                          {delivery.fields[name] || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-text-tertiary">{t('webhookNoDelivery')}</p>
          )}
        </Card>

        <Card className="space-y-3">
          <div>
            <h2 className="text-base font-medium">{t('webhookMapping')}</h2>
            <p className="mt-1 text-sm text-text-secondary">{t('webhookMappingHint')}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {TARGETS.map(({ target, label }) => {
              const current = page.webhook_mapping[target] ?? AUTO;
              const detected = !page.webhook_mapping[target] ? delivery?.matched[target] : null;
              const options = [...new Set([...fieldNames, ...(current ? [current] : [])])];
              return (
                <Select
                  key={target}
                  label={t(label)}
                  value={current}
                  disabled={busy}
                  onChange={(e) => setMapping(target, e.target.value)}
                >
                  <option value={AUTO}>
                    {detected ? t('webhookAutoDetected').replace('{field}', detected) : t('webhookAuto')}
                  </option>
                  {options.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              );
            })}
          </div>
        </Card>
      </div>

      <Card className="space-y-4">
        <h2 className="text-base font-medium">{t('webhookSetup')}</h2>
        <div className="flex flex-wrap gap-1.5">
          {WEBHOOK_GUIDES.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGuideId(g.id)}
              className={cn(
                'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors duration-150',
                g.id === guide.id
                  ? 'border-black bg-black text-white'
                  : 'border-border text-text-secondary hover:bg-[#f5f5f5]',
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          {guide.steps[lang].map((step, i) => (
            <li key={i}>
              <RichText text={step} />
            </li>
          ))}
        </ol>
        {guide.code && (
          <div className="relative">
            <pre className="overflow-x-auto rounded-md border border-border bg-[#fafafa] p-3 pr-12 font-mono text-xs leading-relaxed">
              {guide.code(url)}
            </pre>
            <button
              type="button"
              aria-label={t('copyCheckInLink')}
              onClick={() => copy(`code-${guide.id}`, guide.code!(url))}
              className="absolute right-2 top-2 rounded-md border border-border bg-white p-1.5 text-text-secondary hover:text-text"
            >
              {copied === `code-${guide.id}` ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        )}
        {guide.note && <p className="text-sm text-text-tertiary">{guide.note[lang]}</p>}
      </Card>

      <ConfirmDialog
        open={confirmRegenerate}
        title={t('regenerateUrl')}
        message={t('confirmRegenerateUrl')}
        confirmLabel={t('regenerateUrl')}
        destructive
        onConfirm={regenerate}
        onCancel={() => setConfirmRegenerate(false)}
      />
    </div>
  );
};
