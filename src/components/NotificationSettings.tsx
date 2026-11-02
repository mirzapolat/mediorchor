import { useEffect, useState } from 'react';
import { BellRing, Smartphone } from 'lucide-react';
import { NOTIFICATION_AREAS, NOTIFICATION_CHANNELS, type NotificationChannel } from '@shared/notifications';
import { api } from '@/lib/api';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import {
  AREA_LABEL,
  CHANNEL_LABEL,
  categoryHint,
  categoryLabel,
  disablePush,
  enablePush,
  lookOf,
  pushState,
  type CategorySetting,
  type NotificationSettings as Settings,
  type PushState,
} from '@/lib/notifications';
import { Button } from './Button';
import { PageSpinner } from './Spinner';
import { Toast, useToast } from './Toast';

// Account → Notifications: per category how it arrives — not at all, in the
// app, in the app and as push (installed app), or in the app and by email.
// Grouped by area; a whole area can be set at once. Push needs a registered
// device (the installed app), which the card on top takes care of.
export const NotificationSettings = () => {
  const { t } = useI18n();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const load = () =>
    api.rpc('notification_settings').then(({ data }) => {
      if (data) setSettings(data as Settings);
    });

  useEffect(() => {
    void load();
    void pushState().then(setPush);
  }, []);

  if (!settings || push === null) return <PageSpinner />;

  const devices = settings.push_devices.length;
  // Push can be chosen once a device receives it, or right here in the
  // installed app (choosing it turns it on for this device).
  const pushSelectable = devices > 0 || push === 'on' || push === 'off';

  const turnOnPush = async () => {
    setBusy(true);
    setError(null);
    try {
      const state = await enablePush(settings.push_key);
      setPush(state);
      if (state === 'on') track('notifications-push-on');
      await load();
      return state === 'on';
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const turnOffPush = async () => {
    setBusy(true);
    try {
      setPush(await disablePush());
      await load();
    } finally {
      setBusy(false);
    }
  };

  const choose = async (categories: CategorySetting[], channel: NotificationChannel) => {
    if (channel === 'push' && push === 'off' && devices === 0 && !(await turnOnPush())) return;
    const before = settings.categories;
    const ids = new Set(categories.map((c) => c.id));
    setSettings({ ...settings, categories: before.map((c) => (ids.has(c.id) ? { ...c, channel } : c)) });
    const { error: saveError } = await api.rpc('set_notification_channel', { categories: [...ids], channel });
    track('notifications-channel', { channel, scope: categories.length > 1 ? 'area' : 'one' });
    if (saveError) {
      setSettings((s) => (s ? { ...s, categories: before } : s));
      setError(saveError.message);
    }
  };

  const sendTest = async () => {
    await api.rpc('push_test', { title: t('notifPushTestTitle'), body: t('notifPushTestBody') });
    toast.show(t('notifPushTestSent'));
  };

  const usesPush = settings.categories.some((c) => c.channel === 'push');

  return (
    <div className="space-y-6">
      <PushCard
        state={push}
        devices={devices}
        busy={busy}
        highlight={usesPush && devices === 0}
        onEnable={() => void turnOnPush()}
        onDisable={() => void turnOffPush()}
        onTest={() => void sendTest()}
      />

      <p className="text-sm text-text-secondary">{t('notifChannelsHint')}</p>
      {error && <p className="text-sm text-danger-strong">{error}</p>}

      {NOTIFICATION_AREAS.map((area) => {
        const rows = settings.categories.filter((c) => c.area === area);
        if (rows.length === 0) return null;
        const areaLabel = t('notifSetArea').replace('{area}', t(AREA_LABEL[area]));
        return (
          <section key={area} className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t(AREA_LABEL[area])}</h2>
              {rows.length > 1 && (
                <select
                  aria-label={areaLabel}
                  value=""
                  onChange={(e) => {
                    const channel = e.target.value as NotificationChannel;
                    if (channel) void choose(rows, channel);
                  }}
                  className="h-8 rounded-lg border border-border bg-surface pl-2 pr-7 text-xs text-text-secondary"
                >
                  <option value="">{t('notifSetAll')}</option>
                  {NOTIFICATION_CHANNELS.map((c) => (
                    <option
                      key={c}
                      value={c}
                      disabled={(c === 'push' && !pushSelectable) || (c === 'email' && !settings.mail_enabled)}
                    >
                      {t(CHANNEL_LABEL[c])}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <ul className="overflow-hidden rounded-2xl border border-border bg-surface">
              {rows.map((row) => (
                <CategoryRow
                  key={row.id}
                  row={row}
                  pushSelectable={pushSelectable}
                  pushMissing={row.channel === 'push' && devices === 0}
                  mailEnabled={settings.mail_enabled}
                  onChoose={(channel) => void choose([row], channel)}
                />
              ))}
            </ul>
          </section>
        );
      })}
      <Toast toast={toast.toast} onClose={toast.hide} />
    </div>
  );
};

const CategoryRow = ({
  row,
  pushSelectable,
  pushMissing,
  mailEnabled,
  onChoose,
}: {
  row: CategorySetting;
  pushSelectable: boolean;
  pushMissing: boolean;
  mailEnabled: boolean;
  onChoose: (channel: NotificationChannel) => void;
}) => {
  const { t } = useI18n();
  const { icon: Icon, tone } = lookOf(row.id);
  const mailMissing = row.channel === 'email' && !mailEnabled;
  return (
    <li className="flex flex-col gap-3 border-b border-border px-4 py-3.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          className={cn('mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-muted', tone)}
        >
          <Icon size={16} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-medium leading-snug">{t(categoryLabel(row.id))}</p>
          <p className="mt-0.5 text-sm text-text-secondary">{t(categoryHint(row.id))}</p>
          {(pushMissing || mailMissing) && (
            <p className="mt-1 text-xs text-danger-strong">{pushMissing ? t('notifPushNoDevice') : t('notifEmailOff')}</p>
          )}
        </div>
      </div>
      <div
        role="radiogroup"
        aria-label={t(categoryLabel(row.id))}
        className="grid flex-shrink-0 grid-cols-4 rounded-lg border border-border p-0.5 sm:w-[19rem]"
      >
        {NOTIFICATION_CHANNELS.map((channel) => {
          const selected = row.channel === channel;
          const disabled =
            !selected && ((channel === 'push' && !pushSelectable) || (channel === 'email' && !mailEnabled));
          return (
            <button
              key={channel}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              title={channel === 'push' && disabled ? t('notifPushNotInstalled') : undefined}
              onClick={() => onChoose(channel)}
              className={cn(
                'h-8 truncate rounded-md px-1.5 text-xs font-medium transition-colors duration-150',
                selected
                  ? channel === 'off'
                    ? 'bg-surface-hover text-text'
                    : 'bg-black text-white'
                  : 'text-text-secondary hover:text-text',
                disabled && 'cursor-not-allowed opacity-40 hover:text-text-secondary',
              )}
            >
              {t(CHANNEL_LABEL[channel])}
            </button>
          );
        })}
      </div>
    </li>
  );
};

// This device: push on or off, a test, and why it can't be used.
const PushCard = ({
  state,
  devices,
  busy,
  highlight,
  onEnable,
  onDisable,
  onTest,
}: {
  state: PushState;
  devices: number;
  busy: boolean;
  highlight: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onTest: () => void;
}) => {
  const { t } = useI18n();
  const hint =
    state === 'not-installed'
      ? t('notifPushNotInstalled')
      : state === 'denied'
        ? t('notifPushDenied')
        : state === 'unsupported'
          ? t('notifPushUnsupported')
          : null;
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-2xl border bg-surface p-4 sm:flex-row sm:items-center',
        highlight ? 'border-accent/50' : 'border-border',
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <Smartphone size={19} />
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {t('notifPushTitle')}
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-medium',
                state === 'on' ? 'bg-success-soft text-success-strong' : 'bg-surface-muted text-text-tertiary',
              )}
            >
              {state === 'on' ? t('notifPushOn') : t('notifPushOff')}
            </span>
          </p>
          <p className="mt-0.5 text-sm text-text-secondary">
            {hint ?? (devices > 0 ? t('notifPushDevices').replace('{n}', String(devices)) : t('notifPushNoDevice'))}
          </p>
        </div>
      </div>
      <div className="flex flex-shrink-0 flex-wrap gap-2">
        {state === 'on' && (
          <>
            <Button variant="secondary" onClick={onTest} className="h-9">
              <BellRing size={15} />
              {t('notifPushTest')}
            </Button>
            <Button variant="secondary" onClick={onDisable} disabled={busy} className="h-9">
              {t('notifPushDisable')}
            </Button>
          </>
        )}
        {state === 'off' && (
          <Button onClick={onEnable} disabled={busy} className="h-9">
            {t('notifPushEnable')}
          </Button>
        )}
      </div>
    </div>
  );
};
