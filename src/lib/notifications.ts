// The notification center on the client: types, how each category looks
// (icon, tone, wording keys), the server calls and the push subscription of
// this device. Categories and channels come from shared/notifications.ts.
import {
  BedDouble,
  BellRing,
  CalendarClock,
  CalendarPlus,
  CalendarRange,
  CalendarX2,
  ClipboardList,
  FolderPlus,
  Hourglass,
  LogIn,
  Megaphone,
  Music,
  ScanFace,
  ShieldAlert,
  Ticket,
  UserCog,
  UserPlus,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import type { NotificationArea, NotificationCategoryId, NotificationChannel } from '@shared/notifications';
import type { TranslationKey } from './i18n';
import { api } from './api';
import { isInstalled } from './pwa';

export interface NotificationItem {
  id: string;
  category: string;
  title: string;
  body: string;
  link: string | null;
  count: number;
  created_at: string;
  read_at: string | null;
  archived_at: string | null;
  project_id: string | null;
  project_name: string | null;
}

export interface NotificationPage {
  items: NotificationItem[];
  has_more: boolean;
  unread: number;
  areas: Partial<Record<NotificationArea, { total: number; unread: number }>>;
  done_count: number;
}

export interface CategorySetting {
  id: NotificationCategoryId;
  area: NotificationArea;
  channel: NotificationChannel;
  default: NotificationChannel;
}

export interface NotificationSettings {
  categories: CategorySetting[];
  mail_enabled: boolean;
  push_key: string;
  push_devices: { endpoint: string; user_agent: string | null; created_at: string; last_used_at: string | null }[];
}

// Icon and colour per category (tone classes are theme tokens).
export const CATEGORY_LOOK: Record<NotificationCategoryId, { icon: LucideIcon; tone: string }> = {
  event_reminder: { icon: BellRing, tone: 'text-chart-1' },
  event_new: { icon: CalendarPlus, tone: 'text-chart-1' },
  event_changed: { icon: CalendarClock, tone: 'text-chart-1' },
  event_cancelled: { icon: CalendarX2, tone: 'text-danger' },
  attendance_changed: { icon: UserX, tone: 'text-chart-3' },
  weekly_overview: { icon: CalendarRange, tone: 'text-chart-1' },
  project_added: { icon: FolderPlus, tone: 'text-chart-2' },
  project_info: { icon: Megaphone, tone: 'text-chart-2' },
  piece_added: { icon: Music, tone: 'text-chart-4' },
  concert_published: { icon: Ticket, tone: 'text-chart-5' },
  weekend_published: { icon: CalendarRange, tone: 'text-chart-5' },
  weekend_rooms: { icon: BedDouble, tone: 'text-chart-5' },
  survey_new: { icon: ClipboardList, tone: 'text-chart-6' },
  survey_deadline: { icon: Hourglass, tone: 'text-chart-6' },
  registration_new: { icon: UserPlus, tone: 'text-chart-2' },
  checkin_unrecognized: { icon: ScanFace, tone: 'text-chart-3' },
  group_absence: { icon: UserX, tone: 'text-chart-3' },
  signup_pending: { icon: UserCog, tone: 'text-chart-4' },
  account_role: { icon: UserCog, tone: 'text-text-secondary' },
  security_login: { icon: LogIn, tone: 'text-text-secondary' },
  security_change: { icon: ShieldAlert, tone: 'text-danger' },
};

export const lookOf = (category: string) =>
  CATEGORY_LOOK[category as NotificationCategoryId] ?? { icon: BellRing, tone: 'text-text-secondary' };

// Settings wording: `notif_<id>` (label) and `notif_<id>Hint`.
export const categoryLabel = (id: NotificationCategoryId) => `notif_${id}` as TranslationKey;
export const categoryHint = (id: NotificationCategoryId) => `notif_${id}Hint` as TranslationKey;

export const AREA_LABEL: Record<NotificationArea, TranslationKey> = {
  events: 'notifAreaEvents',
  project: 'notifAreaProject',
  surveys: 'notifAreaSurveys',
  management: 'notifAreaManagement',
  account: 'notifAreaAccount',
};

export const CHANNEL_LABEL: Record<NotificationChannel, TranslationKey> = {
  off: 'notifChannelOff',
  inapp: 'notifChannelInapp',
  push: 'notifChannelPush',
  email: 'notifChannelEmail',
};

// ---------------------------------------------------------------------------
// Server calls
// ---------------------------------------------------------------------------

export const fetchNotifications = async (args: { view: 'open' | 'done'; area?: string | null; before?: string }) => {
  const { data, error } = await api.rpc('my_notifications', {
    view: args.view,
    area: args.area ?? null,
    before: args.before ?? null,
  });
  if (error) throw error;
  return data as NotificationPage;
};

export const fetchUnread = async () => {
  const { data, error } = await api.rpc('notification_summary');
  if (error) throw error;
  return (data as { unread: number }).unread;
};

export const markNotifications = async (args: { ids?: string[]; all?: boolean; read: boolean }) => {
  const { data, error } = await api.rpc('notifications_mark', args);
  if (error) throw error;
  return data as { changed: number; unread: number };
};

export const archiveNotifications = async (args: { ids?: string[]; all_read?: boolean; archived: boolean }) => {
  const { data, error } = await api.rpc('notifications_archive', args);
  if (error) throw error;
  return data as { ids: string[]; unread: number };
};

// ---------------------------------------------------------------------------
// Push on this device (installed app only)
// ---------------------------------------------------------------------------

export type PushState = 'unsupported' | 'not-installed' | 'denied' | 'off' | 'on';

const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// The worker is registered in production builds (src/lib/pwa.ts).
const registration = async () => (pushSupported() ? ((await navigator.serviceWorker.getRegistration()) ?? null) : null);

export const pushState = async (): Promise<PushState> => {
  if (!pushSupported()) return 'unsupported';
  if (!isInstalled()) return 'not-installed';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  if (!reg) return 'unsupported';
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
};

const keyBytes = (base64url: string) => {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

const b64url = (buffer: ArrayBuffer | null) =>
  buffer
    ? btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
    : '';

const register = async (sub: PushSubscription) => {
  const { error } = await api.rpc('push_subscribe', {
    endpoint: sub.endpoint,
    p256dh: b64url(sub.getKey('p256dh')),
    auth: b64url(sub.getKey('auth')),
    user_agent: navigator.userAgent,
  });
  if (error) throw error;
};

// Asks for permission (must follow a tap) and registers this device.
export const enablePush = async (publicKey: string): Promise<PushState> => {
  const reg = await registration();
  if (!reg || !isInstalled()) return pushState();
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await register(sub);
  return 'on';
};

export const disablePush = async (): Promise<PushState> => {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.rpc('push_unsubscribe', { endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
  return pushState();
};

// After signing in on a device that already allowed push: make sure the
// server knows it belongs to this account.
export const refreshPushSubscription = async () => {
  if ((await pushState()) !== 'on') return;
  const sub = await (await registration())?.pushManager.getSubscription();
  if (sub) await register(sub).catch(() => undefined);
};

// The unread count on the installed app's icon, where supported.
export const setAppBadge = (count: number) => {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (!isInstalled()) return;
  if (count > 0) void nav.setAppBadge?.(count).catch(() => undefined);
  else void nav.clearAppBadge?.().catch(() => undefined);
};
