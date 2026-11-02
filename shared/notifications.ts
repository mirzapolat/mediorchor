// The notification categories, shared by the server (who gets what, the
// default channel) and the app (settings, icons). Adding a category: an entry
// here, its texts in server/locales and src/locales, an icon in
// src/lib/notifications.ts, and something that produces it (a trigger into
// notification_queue plus a handler in server/notificationCenter.ts, or a
// scheduled check there).

// How a notification reaches its account. Every channel except 'off' also
// puts it into the notification center.
export const NOTIFICATION_CHANNELS = ['off', 'inapp', 'push', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const isNotificationChannel = (value: unknown): value is NotificationChannel =>
  typeof value === 'string' && (NOTIFICATION_CHANNELS as readonly string[]).includes(value);

// Sections of the settings page and filters of the notification center.
export const NOTIFICATION_AREAS = ['events', 'project', 'surveys', 'management', 'account'] as const;
export type NotificationArea = (typeof NOTIFICATION_AREAS)[number];

// Who a category is for: participants (accounts that take part in
// projects), those who manage projects (Stimmeltern and up), someone
// responsible for a group (or a manager), admins, or every account.
export type NotificationAudience = 'participant' | 'manager' | 'responsible' | 'admin' | 'everyone';

export interface NotificationCategory {
  id: string;
  area: NotificationArea;
  audience: NotificationAudience;
  default: NotificationChannel;
}

export const NOTIFICATION_CATEGORIES = [
  // Proben
  { id: 'event_reminder', area: 'events', audience: 'participant', default: 'inapp' },
  { id: 'event_new', area: 'events', audience: 'participant', default: 'inapp' },
  { id: 'event_changed', area: 'events', audience: 'participant', default: 'inapp' },
  { id: 'event_cancelled', area: 'events', audience: 'participant', default: 'inapp' },
  { id: 'attendance_changed', area: 'events', audience: 'participant', default: 'inapp' },
  { id: 'weekly_overview', area: 'events', audience: 'participant', default: 'off' },
  // Projects
  { id: 'project_added', area: 'project', audience: 'participant', default: 'inapp' },
  { id: 'project_info', area: 'project', audience: 'participant', default: 'inapp' },
  { id: 'piece_added', area: 'project', audience: 'participant', default: 'inapp' },
  { id: 'concert_published', area: 'project', audience: 'participant', default: 'inapp' },
  { id: 'weekend_published', area: 'project', audience: 'participant', default: 'inapp' },
  { id: 'weekend_rooms', area: 'project', audience: 'participant', default: 'inapp' },
  // Surveys
  { id: 'survey_new', area: 'surveys', audience: 'participant', default: 'inapp' },
  { id: 'survey_deadline', area: 'surveys', audience: 'participant', default: 'inapp' },
  // Managing projects
  { id: 'registration_new', area: 'management', audience: 'manager', default: 'inapp' },
  { id: 'checkin_unrecognized', area: 'management', audience: 'manager', default: 'inapp' },
  { id: 'group_absence', area: 'management', audience: 'responsible', default: 'inapp' },
  { id: 'signup_pending', area: 'management', audience: 'admin', default: 'email' },
  // The own account
  { id: 'account_role', area: 'account', audience: 'everyone', default: 'inapp' },
  { id: 'security_login', area: 'account', audience: 'everyone', default: 'email' },
  { id: 'security_change', area: 'account', audience: 'everyone', default: 'email' },
] as const satisfies readonly NotificationCategory[];

export type NotificationCategoryId = (typeof NOTIFICATION_CATEGORIES)[number]['id'];

const BY_ID = new Map<string, NotificationCategory>(NOTIFICATION_CATEGORIES.map((c) => [c.id, c]));

export const notificationCategory = (id: string): NotificationCategory | undefined => BY_ID.get(id);
