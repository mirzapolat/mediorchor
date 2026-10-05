import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Textarea } from '@/components/Input';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useEventContext } from '@/layouts/eventContext';

export const EventSettingsPage = () => {
  const { t } = useI18n();
  const { project, event, reloadEvent } = useEventContext();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: event.name,
    description: event.description ?? '',
    date: event.date ?? '',
    time: event.time ?? '',
    end_time: event.end_time ?? '',
    in_calendar: event.in_calendar,
    location: event.location ?? '',
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
    await api
      .from('events')
      .update({
        name: form.name.trim(),
        description: form.description.trim() || null,
        date: form.date || null,
        time: form.time || null,
        end_time: form.time && form.end_time ? form.end_time : null,
        in_calendar: form.in_calendar,
        location: form.location.trim() || null,
      })
      .eq('id', event.id);
    setSaving(false);
    setSaved(true);
    reloadEvent();
  };

  const remove = async () => {
    await api.from('events').delete().eq('id', event.id);
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
          <Textarea
            label={`${t('eventDescription')} (${t('optional')})`}
            placeholder={t('eventDescriptionPlaceholder')}
            rows={2}
            maxLength={500}
            value={form.description}
            onChange={(e) => update({ description: e.target.value })}
          />
          <Input
            type="date"
            label={`${t('date')} (${t('optional')})`}
            value={form.date}
            onChange={(e) => update({ date: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              type="time"
              label={`${t('startTime')} (${t('optional')})`}
              value={form.time}
              onChange={(e) => update({ time: e.target.value })}
            />
            <Input
              type="time"
              label={`${t('endTime')} (${t('optional')})`}
              value={form.end_time}
              disabled={!form.time}
              onChange={(e) => update({ end_time: e.target.value })}
            />
          </div>
          <p className="-mt-2 text-xs text-text-tertiary">{t('endTimeHint')}</p>
          <Input
            label={`${t('eventLocation')} (${t('optional')})`}
            placeholder={t('eventLocationPlaceholder')}
            maxLength={200}
            value={form.location}
            onChange={(e) => update({ location: e.target.value })}
          />
          <label className="flex cursor-pointer items-center justify-between gap-4 border-t border-border pt-4">
            <span>
              <span className="block font-medium">{t('showInCalendar')}</span>
              <span className="mt-0.5 block text-sm text-text-secondary">{t('showInCalendarHint')}</span>
            </span>
            <input
              type="checkbox"
              className="h-4 w-4 flex-shrink-0 accent-black"
              checked={form.in_calendar}
              onChange={(e) => update({ in_calendar: e.target.checked })}
            />
          </label>
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
