import { useEffect, useState, type FormEvent } from 'react';
import { Button } from './Button';
import { Input } from './Input';
import { MarkdownEditor } from './MarkdownEditor';
import { Modal } from './Modal';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import type { RegistrationPage } from '@/types';

interface FormState {
  title: string;
  description: string;
  ask_email: boolean;
  ask_group: boolean;
  auto_transfer: boolean;
}

const blank: FormState = {
  title: '',
  description: '',
  ask_email: true,
  ask_group: true,
  auto_transfer: false,
};

const Checkbox = ({
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
  <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border px-4 py-3 hover:bg-[#fafafa]">
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
        title: page.title,
        description: page.description,
        ask_email: page.ask_email,
        ask_group: page.ask_group,
        auto_transfer: page.auto_transfer,
      });
    } else {
      setForm(blank);
    }
  }, [open, page]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const payload = {
      project_id: projectId,
      title: form.title.trim(),
      description: form.description,
      ask_email: form.ask_email,
      ask_group: form.ask_group,
      auto_transfer: form.auto_transfer,
    };
    if (page) {
      await api.from('registration_pages').update(payload).eq('id', page.id);
    } else {
      await api.from('registration_pages').insert(payload);
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
        <Input
          label={t('registrationTitle')}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          required
          autoFocus
        />
        <MarkdownEditor
          label={t('registrationDescription')}
          hint={t('registrationDescriptionHint')}
          value={form.description}
          onChange={(value) => setForm((f) => ({ ...f, description: value }))}
        />

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

        <Checkbox
          checked={form.auto_transfer}
          onChange={(v) => setForm({ ...form, auto_transfer: v })}
          label={t('autoTransfer')}
          hint={t('autoTransferHint')}
        />
      </form>
    </Modal>
  );
};
