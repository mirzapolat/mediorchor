import { useEffect, useState, type FormEvent } from 'react';
import { FileText, Webhook } from 'lucide-react';
import { Button } from './Button';
import { Input } from './Input';
import { MarkdownEditor } from './MarkdownEditor';
import { DeadlineInput } from './DeadlineInput';
import { Modal } from './Modal';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fromLocalInput, toLocalInput } from '@/lib/registrationDeadline';
import type { RegistrationPage, RegistrationSource } from '@/types';

interface FormState {
  source: RegistrationSource;
  title: string;
  description: string;
  ask_email: boolean;
  ask_group: boolean;
  auto_transfer: boolean;
  closes_at: string; // datetime-local value, '' = none
}

const blank: FormState = {
  source: 'form',
  title: '',
  description: '',
  ask_email: true,
  ask_group: true,
  auto_transfer: false,
  closes_at: '',
};

export const Checkbox = ({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) => (
  <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border px-4 py-3 hover:bg-surface-subtle">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-0.5 accent-black"
    />
    <span>
      <span className="block text-sm font-medium">{label}</span>
      {hint ? <span className="mt-0.5 block text-sm text-text-secondary">{hint}</span> : null}
    </span>
  </label>
);

export const RegistrationPageForm = ({
  open,
  projectId,
  page,
  onClose,
  onSaved,
}: {
  open: boolean;
  projectId: string;
  page: RegistrationPage | null;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(blank);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (page) {
      setForm({
        source: page.source,
        title: page.title,
        description: page.description,
        ask_email: page.ask_email,
        ask_group: page.ask_group,
        auto_transfer: page.auto_transfer,
        closes_at: toLocalInput(page.closes_at),
      });
    } else {
      setForm(blank);
    }
  }, [open, page]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    // Webhook entries bring whatever fields they have, so the list always
    // shows the email and group columns for them.
    const webhook = form.source === 'webhook';
    const payload = {
      project_id: projectId,
      title: form.title.trim(),
      description: webhook ? '' : form.description,
      ask_email: webhook || form.ask_email,
      ask_group: webhook || form.ask_group,
      auto_transfer: form.auto_transfer,
      closes_at: webhook ? null : fromLocalInput(form.closes_at),
    };
    if (page) {
      await api.from('registration_pages').update(payload).eq('id', page.id);
    } else {
      // New sources start out active so they can take registrations right away.
      await api.from('registration_pages').insert({ ...payload, source: form.source, is_active: true });
    }
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal
      open={open}
      size="3xl"
      title={page ? t('editRegistrationPage') : t('newRegistrationPage')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" form="registration-page-form" disabled={saving || !form.title.trim()}>
            {saving ? t('loading') : page ? t('save') : t('create')}
          </Button>
        </>
      }
    >
      <form id="registration-page-form" onSubmit={save} className="space-y-4">
        {!page && (
          <div>
            <p className="mb-2 text-sm font-medium text-text-secondary">{t('registrationSource')}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(
                [
                  ['form', FileText, 'sourceForm', 'sourceFormHint'],
                  ['webhook', Webhook, 'sourceWebhook', 'sourceWebhookHint'],
                ] as const
              ).map(([source, Icon, label, hint]) => (
                <button
                  key={source}
                  type="button"
                  onClick={() => setForm({ ...form, source })}
                  className={cn(
                    'flex items-start gap-3 rounded-md border px-4 py-3 text-left transition-colors duration-150',
                    form.source === source
                      ? 'border-black bg-surface-subtle'
                      : 'border-border hover:bg-surface-subtle',
                  )}
                >
                  <Icon size={18} className="mt-0.5 flex-shrink-0" />
                  <span>
                    <span className="block text-sm font-medium">{t(label)}</span>
                    <span className="mt-0.5 block text-sm text-text-secondary">{t(hint)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        <Input
          label={t('registrationTitle')}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          required
          autoFocus
        />
        {form.source === 'form' && (
          <>
            <MarkdownEditor
              label={t('registrationDescription')}
              hint={t('registrationDescriptionHint')}
              value={form.description}
              onChange={(value) => setForm((f) => ({ ...f, description: value }))}
            />

            <DeadlineInput value={form.closes_at} onChange={(v) => setForm((f) => ({ ...f, closes_at: v }))} />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Checkbox
                checked={form.ask_email}
                onChange={(v) => setForm({ ...form, ask_email: v })}
                label={t('askEmail')}
              />
              <Checkbox
                checked={form.ask_group}
                onChange={(v) => setForm({ ...form, ask_group: v })}
                label={t('askGroup')}
                hint={t('askGroupProjectHint')}
              />
            </div>
          </>
        )}

        <Checkbox
          checked={form.auto_transfer}
          onChange={(v) => setForm({ ...form, auto_transfer: v })}
          label={t('autoTransfer')}
          hint={
            form.source === 'webhook'
              ? `${t('autoTransferHint')} ${t('webhookAutoTransferNote')}`
              : t('autoTransferHint')
          }
        />
      </form>
    </Modal>
  );
};
