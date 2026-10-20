import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, Download, ExternalLink, QrCode, RefreshCw, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/Button';
import { Textarea } from '@/components/Input';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { downloadBlob, filenamePart, toCsv } from '@/lib/absenceExports';
import { formDate, formUrl, type FormDetail, type FormInvite } from '@/lib/forms';

// Sharing a survey: its link (copy, QR code, a new link that retires the
// old one) and personal one-time links for guests, exportable as CSV.
export const SurveyShare = ({ detail, onRotated }: { detail: FormDetail; onRotated: () => Promise<void> }) => {
  const { t, lang } = useI18n();
  const { form } = detail;
  const url = formUrl(form.token);
  const [copied, setCopied] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [invites, setInvites] = useState<FormInvite[]>([]);
  const [lines, setLines] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadInvites = useCallback(async () => {
    const { data } = await api.from('form_invites').select('*').eq('form_id', form.id).order('created_at');
    setInvites((data as FormInvite[] | null) ?? []);
  }, [form.id]);
  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  const copy = (text: string, key: string) =>
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
    });

  const rotate = async () => {
    setRotating(false);
    await api.rpc('form_rotate_link', { p_form_id: form.id });
    await onRotated();
  };

  // "Name; email" (or either) per line.
  const createInvites = async () => {
    setError(null);
    const rows = lines
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const parts = l.split(/[;,\t]/).map((p) => p.trim());
        const email = parts.find((p) => p.includes('@')) ?? '';
        const label = parts.filter((p) => p !== email).join(' ').trim();
        return { label, email };
      });
    if (!rows.length) return;
    const { error: rpcError } = await api.rpc('form_invites_create', { p_form_id: form.id, p_rows: rows });
    if (rpcError) return setError(rpcError.message);
    setLines('');
    await loadInvites();
  };

  const removeInvite = async (invite: FormInvite) => {
    await api.from('form_invites').delete().eq('id', invite.id);
    await loadInvites();
  };

  const exportCsv = () => {
    const csv = toCsv([
      [t('name'), t('email'), t('surveyInviteLink'), t('surveyInviteUsed')],
      ...invites.map((i) => [i.label, i.email ?? '', formUrl(form.token, { i: i.token }), i.used_at ? formDate(i.used_at, lang) : '']),
    ]);
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${filenamePart(form.title)}-links.csv`);
  };

  const published = form.status !== 'draft' && Boolean(form.version_id);

  return (
    <div className="space-y-4">
      {!published && <p className="rounded-xl bg-info-soft px-3 py-2 text-sm">{t('surveyShareUnpublished')}</p>}

      <section className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('surveyLink')}</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            readOnly
            value={url}
            aria-label={t('surveyLink')}
            onFocus={(e) => e.target.select()}
            className="h-10 min-w-0 flex-1 rounded-md border border-border bg-surface-subtle px-3 font-mono text-sm"
          />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => copy(url, 'link')}>
              {copied === 'link' ? <Check size={15} /> : <Copy size={15} />}
              {copied === 'link' ? t('copied') : t('copy')}
            </Button>
            <a href={url} target="_blank" rel="noopener noreferrer">
              <Button variant="secondary" aria-label={t('openLink')}>
                <ExternalLink size={15} />
              </Button>
            </a>
            <Button variant="secondary" aria-pressed={showQr} onClick={() => setShowQr((v) => !v)} aria-label={t('surveyQr')}>
              <QrCode size={15} />
            </Button>
          </div>
        </div>
        {showQr && (
          <div className="mt-4 flex justify-center">
            <div className="rounded-xl bg-paper p-4">
              <QRCodeSVG value={url} size={200} />
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <p className="min-w-0 flex-1 text-xs text-text-tertiary">{t('surveyRotateHint')}</p>
          <Button variant="secondary" className="h-8 px-3" onClick={() => setRotating(true)}>
            <RefreshCw size={14} />
            {t('surveyRotate')}
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('surveyInvites')}</h2>
          {invites.length > 0 && (
            <Button variant="secondary" className="h-8 px-3" onClick={exportCsv}>
              <Download size={14} />
              CSV
            </Button>
          )}
        </div>
        <p className="mb-3 text-sm text-text-secondary">{t('surveyInvitesHint')}</p>
        <Textarea
          label={t('surveyInvitesAdd')}
          placeholder={t('surveyInvitesPlaceholder')}
          rows={3}
          value={lines}
          onChange={(e) => setLines(e.target.value)}
        />
        <div className="mt-2 flex justify-end">
          <Button onClick={() => void createInvites()} disabled={!lines.trim()}>
            <UserPlus size={15} />
            {t('surveyInvitesCreate')}
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        {invites.length > 0 && (
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
            {invites.map((i) => (
              <li key={i.id} className="group/item flex items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{i.label || i.email}</span>
                  {i.label && i.email && <span className="block truncate text-xs text-text-tertiary">{i.email}</span>}
                </span>
                {i.used_at ? (
                  <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success-strong">{t('surveyInviteUsed')}</span>
                ) : (
                  <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-text-tertiary">{t('surveyInviteOpen')}</span>
                )}
                <button
                  type="button"
                  onClick={() => copy(formUrl(form.token, { i: i.token }), i.id)}
                  aria-label={`${t('copy')}: ${i.label || i.email}`}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
                >
                  {copied === i.id ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <button
                  type="button"
                  onClick={() => void removeInvite(i)}
                  aria-label={`${t('delete')}: ${i.label || i.email}`}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text focus:opacity-100 lg:opacity-0 lg:group-hover/item:opacity-100"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={rotating}
        title={t('surveyRotate')}
        message={t('surveyRotateConfirm')}
        confirmLabel={t('surveyRotate')}
        destructive
        onConfirm={() => void rotate()}
        onCancel={() => setRotating(false)}
      />
    </div>
  );
};
