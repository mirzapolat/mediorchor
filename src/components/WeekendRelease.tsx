import { Copy, DoorOpen, EyeOff, Globe, Link2, Lock, RefreshCw, Send, type LucideIcon } from 'lucide-react';
import { Button } from './Button';
import { cn } from '@/lib/cn';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { api } from '@/lib/api';
import { weekendLinkUrl, type RoomsStatus, type Weekend } from '@/lib/weekends';

// What participants see of a rehearsal weekend, released part by part: the
// details (released or not) and the room allocation (off, open, locked).

const Pill = ({ on, icon: Icon, label }: { on: boolean; icon: LucideIcon; label: TranslationKey }) => {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        'inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold',
        on ? 'bg-success-soft text-success-strong' : 'bg-surface-muted text-text-tertiary',
      )}
    >
      <Icon size={12} />
      {t(label)}
    </span>
  );
};

export const ReleasePill = ({ released }: { released: boolean }) =>
  released ? <Pill on icon={Globe} label="weekendReleased" /> : <Pill on={false} icon={Lock} label="weekendNotReleased" />;

const ROOMS: Record<RoomsStatus, { icon: LucideIcon; label: TranslationKey }> = {
  hidden: { icon: EyeOff, label: 'weekendRoomsHidden' },
  open: { icon: DoorOpen, label: 'weekendRoomsOpen' },
  locked: { icon: Lock, label: 'weekendRoomsLocked' },
};

export const RoomsStatusPill = ({ status }: { status: RoomsStatus }) => (
  <Pill on={status === 'open'} icon={ROOMS[status].icon} label={ROOMS[status].label} />
);

// The buttons to move the room allocation on: release it, lock the choice,
// open it again, or switch it off.
export const RoomsStatusActions = ({
  status,
  onChange,
  busy,
}: {
  status: RoomsStatus;
  onChange: (next: RoomsStatus) => void;
  busy?: boolean;
}) => {
  const { t } = useI18n();
  const next: { to: RoomsStatus; icon: LucideIcon; label: TranslationKey; primary?: boolean }[] =
    status === 'hidden'
      ? [{ to: 'open', icon: Send, label: 'weekendRoomsRelease', primary: true }]
      : status === 'open'
        ? [
            { to: 'locked', icon: Lock, label: 'weekendRoomsLock' },
            { to: 'hidden', icon: EyeOff, label: 'weekendRoomsDisable' },
          ]
        : [
            { to: 'open', icon: DoorOpen, label: 'weekendRoomsReopen', primary: true },
            { to: 'hidden', icon: EyeOff, label: 'weekendRoomsDisable' },
          ];
  return (
    <>
      {next.map(({ to, icon: Icon, label, primary }) => (
        <Button key={to} variant={primary ? 'primary' : 'secondary'} disabled={busy} onClick={() => onChange(to)}>
          <Icon size={16} />
          {t(label)}
        </Button>
      ))}
    </>
  );
};

// The shared link to the room choice (managers): created on first use, then
// copied; `full` adds making a new one (the old stops working) and
// switching it off. Guests who joined keep their place either way.
export const WeekendLinkControls = ({
  weekend,
  onChanged,
  onMessage,
  full = false,
}: {
  weekend: Pick<Weekend, 'id' | 'link_token'>;
  onChanged: () => void;
  onMessage: (message: string) => void;
  full?: boolean;
}) => {
  const { t } = useI18n();
  const set = async (action: 'create' | 'disable') => {
    const { data, error } = await api.rpc('weekend_link', { p_weekend_id: weekend.id, p_action: action });
    if (error) {
      onMessage(`${t('saveFailed')} (${error.message})`);
      return null;
    }
    onChanged();
    return (data as { token: string | null }).token;
  };
  const copy = async () => {
    const token = weekend.link_token ?? (await set('create'));
    if (!token) return;
    try {
      await navigator.clipboard.writeText(weekendLinkUrl(token));
      onMessage(t('weekendLinkCopied'));
    } catch {
      onMessage(weekendLinkUrl(token));
    }
  };
  return (
    <>
      {full && weekend.link_token && (
        <span
          className="flex h-10 min-w-0 max-w-full items-center gap-1.5 rounded-lg bg-surface-muted px-3 text-xs text-text-secondary sm:max-w-xs"
          title={weekendLinkUrl(weekend.link_token)}
        >
          <Link2 size={13} className="flex-shrink-0" />
          <span className="truncate">{weekendLinkUrl(weekend.link_token)}</span>
        </span>
      )}
      <Button variant={full ? 'primary' : 'secondary'} onClick={() => void copy()}>
        <Copy size={16} />
        {weekend.link_token ? t('weekendLinkCopy') : t('weekendLinkCreate')}
      </Button>
      {full && weekend.link_token && (
        <>
          <Button variant="secondary" onClick={() => void set('create').then((token) => token && onMessage(t('weekendLinkRenewed')))}>
            <RefreshCw size={16} />
            {t('weekendLinkRenew')}
          </Button>
          <Button variant="secondary" onClick={() => void set('disable').then(() => onMessage(t('weekendLinkDisabled')))}>
            <EyeOff size={16} />
            {t('weekendLinkDisable')}
          </Button>
        </>
      )}
    </>
  );
};
