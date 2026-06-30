import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { useEventContext } from '@/layouts/eventContext';

export const EventSettingsPage = () => {
  const { t } = useI18n();
  const { project, event, reloadEvent } = useEventContext();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: event.name,
    date: event.date ?? '',
    time: event.time ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const update = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setSaved(false);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    await supabase
      .from('events')
      .update({ name: form.name.trim(), date: form.date || null, time: form.time || null })
      .eq('id', event.id);
    setSaving(false);
    setSaved(true);
    reloadEvent();
  };

  const remove = async () => {
    await supabase.from('events').delete().eq('id', event.id);
    navigate(`/projects/${project.id}/events`);
  };

  return (
    <>
      <PageHeader title={t('settings')} />

      <form onSubmit={save} className="max-w-xl">
        <Card className="space-y-4">
          <Input
            label={t('eventName')}
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              type="date"
              label={`${t('date')} (${t('optional')})`}
              value={form.date}
              onChange={(e) => update({ date: e.target.value })}
            />
            <Input
              type="time"
              label={`${t('time')} (${t('optional')})`}
              value={form.time}
              onChange={(e) => update({ time: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving || !form.name.trim()}>
              {saving ? t('loading') : t('save')}
            </Button>
            {saved && <span className="text-sm text-text-secondary">✓</span>}
          </div>
        </Card>
      </form>

      <Card className="max-w-xl mt-6 space-y-3">
        <h2 className="text-base font-medium">{t('delete')}</h2>
        <p className="text-sm text-text-secondary">{t('confirmDelete')}</p>
        <Button variant="accent" onClick={() => setConfirmDel(true)}>
          {t('delete')}
        </Button>
      </Card>

      <ConfirmDialog
        open={confirmDel}
        title={t('delete')}
        message={t('confirmDelete')}
        confirmLabel={t('delete')}
        destructive
        onConfirm={remove}
        onCancel={() => setConfirmDel(false)}
      />
    </>
  );
};
