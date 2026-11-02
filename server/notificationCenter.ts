// The notification center's server functions: the own notifications (list,
// read/unread, done), the choice per category of how they arrive, and the
// devices that receive push messages. Notifications are made by the engine
// (notifications.ts). Every function works on the caller's own rows only.
import { db, authUid, ApiError, nowIso } from './db.ts';
import { mailEnabled } from './mail.ts';
import {
  NOTIFICATION_CATEGORIES,
  isNotificationChannel,
  notificationCategory,
  type NotificationCategory,
} from '../shared/notifications.ts';
import { TEST_CATEGORY, channelFor, kickNotifications, unreadCount } from './notifications.ts';
import { pushPublicKey } from './webpush.ts';

type Args = Record<string, unknown>;

const requireUser = () => {
  const uid = authUid();
  if (!uid) throw new ApiError('Authentication required', 401, '42501');
  return uid;
};

const ids = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, 500) : [];

// The categories that concern the account, by its role (and whether it
// looks after a group).
const categoriesFor = (uid: string): NotificationCategory[] => {
  const user = db.prepare('select role from app_users where id = ?').get(uid) as { role: string } | undefined;
  const role = user?.role ?? 'participant';
  const manager = role !== 'participant';
  const responsible =
    manager || Boolean(db.prepare('select 1 from group_responsibles where user_id = ? limit 1').get(uid));
  return NOTIFICATION_CATEGORIES.filter((c) => {
    switch (c.audience) {
      case 'participant':
        return role !== 'music_director';
      case 'manager':
        return manager;
      case 'responsible':
        return responsible;
      case 'admin':
        return role === 'admin';
      default:
        return true;
    }
  });
};

const PAGE = 30;

// One page of notifications, newest first: the open ones (not done) or the
// done ones, optionally of one area; plus the counts per area for filters.
const my_notifications = (args: Args) => {
  const uid = requireUser();
  const done = args.view === 'done';
  const area = typeof args.area === 'string' ? args.area : null;
  const categories = area ? NOTIFICATION_CATEGORIES.filter((c) => c.area === area).map((c) => c.id) : null;
  const before = typeof args.before === 'string' ? args.before : null;
  const limit = Math.min(100, Math.max(1, Number(args.limit) || PAGE));
  const params: Record<string, unknown> = { uid, before, limit: limit + 1, test: TEST_CATEGORY };
  categories?.forEach((c, i) => (params[`c${i}`] = c));
  const inCategories = categories?.length ? `and n.category in (${categories.map((_, i) => `@c${i}`).join(', ')})` : '';
  const rows = db
    .prepare(
      `select n.id, n.category, n.title, n.body, n.link, n.count, n.created_at, n.read_at, n.archived_at,
              n.project_id, p.name as project_name
       from notifications n left join projects p on p.id = n.project_id
       where n.user_id = @uid and n.category <> @test
         and n.archived_at is ${done ? 'not null' : 'null'}
         ${categories ? inCategories || 'and 0' : ''}
         and (@before is null or n.created_at < @before)
       order by n.created_at desc, n.id desc limit @limit`,
    )
    .all(params) as Array<Record<string, unknown>>;
  const counts = db
    .prepare(
      `select category, count(*) as total, sum(read_at is null) as unread from notifications
       where user_id = ? and archived_at is null and category <> ? group by category`,
    )
    .all(uid, TEST_CATEGORY) as { category: string; total: number; unread: number }[];
  const areas: Record<string, { total: number; unread: number }> = {};
  for (const c of counts) {
    const a = notificationCategory(c.category)?.area;
    if (!a) continue;
    areas[a] = { total: (areas[a]?.total ?? 0) + c.total, unread: (areas[a]?.unread ?? 0) + c.unread };
  }
  const doneCount = (
    db
      .prepare('select count(*) as n from notifications where user_id = ? and archived_at is not null and category <> ?')
      .get(uid, TEST_CATEGORY) as { n: number }
  ).n;
  return {
    items: rows.slice(0, limit),
    has_more: rows.length > limit,
    unread: unreadCount(uid),
    areas,
    done_count: doneCount,
  };
};

// For the bell.
const notification_summary = () => ({ unread: unreadCount(requireUser()) });

// Read or unread: some, or all open ones.
const notifications_mark = (args: Args) => {
  const uid = requireUser();
  const read = args.read !== false;
  const value = read ? nowIso() : null;
  const set = read ? 'read_at = coalesce(read_at, @value)' : 'read_at = null';
  let changed = 0;
  if (args.all) {
    changed = db.prepare(`update notifications set ${set} where user_id = @uid and archived_at is null`).run({ uid, value })
      .changes;
  } else {
    const statement = db.prepare(`update notifications set ${set} where user_id = @uid and id = @id`);
    for (const id of ids(args.ids)) changed += statement.run({ uid, value, id }).changes;
  }
  return { changed, unread: unreadCount(uid) };
};

// Done (out of the open list, and read) or back: some, or all read open
// ones. Returns the ids it changed, for "Undo".
const notifications_archive = (args: Args) => {
  const uid = requireUser();
  const archived = args.archived !== false;
  const now = nowIso();
  const target = args.all_read
    ? (
        db
          .prepare('select id from notifications where user_id = ? and archived_at is null and read_at is not null')
          .all(uid) as { id: string }[]
      ).map((r) => r.id)
    : ids(args.ids);
  const statement = archived
    ? db.prepare(
        `update notifications set archived_at = @now, read_at = coalesce(read_at, @now)
         where user_id = @uid and id = @id and archived_at is null`,
      )
    : db.prepare(
        'update notifications set archived_at = null where user_id = @uid and id = @id and archived_at is not null',
      );
  const changed = target.filter((id) => statement.run({ uid, id, now }).changes > 0);
  return { ids: changed, unread: unreadCount(uid) };
};

const notification_settings = () => {
  const uid = requireUser();
  const devices = db
    .prepare(
      'select endpoint, user_agent, created_at, last_used_at from push_subscriptions where user_id = ? order by created_at',
    )
    .all(uid);
  return {
    categories: categoriesFor(uid).map((c) => ({
      id: c.id,
      area: c.area,
      channel: channelFor(uid, c.id),
      default: c.default,
    })),
    mail_enabled: mailEnabled(),
    push_key: pushPublicKey(),
    push_devices: devices,
  };
};

// One channel for one or more categories (a whole area at once).
const set_notification_channel = (args: Args) => {
  const uid = requireUser();
  if (!isNotificationChannel(args.channel)) throw new ApiError('Unknown channel', 400, '23514');
  const allowed = new Set(categoriesFor(uid).map((c) => c.id));
  const wanted = Array.isArray(args.categories) ? ids(args.categories) : [String(args.category ?? '')];
  if (wanted.length === 0 || wanted.some((c) => !allowed.has(c))) {
    throw new ApiError('Unknown category', 400, '23514');
  }
  const statement = db.prepare(
    `insert into notification_prefs (user_id, category, channel) values (?, ?, ?)
     on conflict (user_id, category) do update set channel = excluded.channel`,
  );
  for (const category of wanted) statement.run(uid, category, args.channel);
  return { ok: true };
};

// Push services of the browsers; subscriptions to anything else are refused,
// so the server never sends requests to hosts a user picked.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

const validEndpoint = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 1000) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && PUSH_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
};

const keyOfLength = (value: unknown, bytes: number): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]+=*$/.test(value) && Buffer.from(value, 'base64url').length === bytes;

const push_subscribe = (args: Args) => {
  const uid = requireUser();
  if (!validEndpoint(args.endpoint)) throw new ApiError('Unsupported push service', 400, 'push_endpoint_invalid');
  if (!keyOfLength(args.p256dh, 65) || !keyOfLength(args.auth, 16)) {
    throw new ApiError('Invalid push keys', 400, 'push_keys_invalid');
  }
  const userAgent = typeof args.user_agent === 'string' ? args.user_agent.slice(0, 300) : null;
  // A device that changed accounts moves over to the signed-in one.
  db.prepare(
    `insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) values (?, ?, ?, ?, ?)
     on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh,
       auth = excluded.auth, user_agent = excluded.user_agent`,
  ).run(uid, args.endpoint, args.p256dh, args.auth, userAgent);
  return { ok: true };
};

const push_unsubscribe = (args: Args) => {
  const uid = requireUser();
  db.prepare('delete from push_subscriptions where user_id = ? and endpoint = ?').run(uid, String(args.endpoint ?? ''));
  return { ok: true };
};

// A test message to the account's devices (goes out within a few seconds).
const push_test = (args: Args) => {
  const uid = requireUser();
  const title = typeof args.title === 'string' ? args.title.slice(0, 120) : 'Test';
  const body = typeof args.body === 'string' ? args.body.slice(0, 300) : '';
  const now = nowIso();
  db.prepare(
    `insert into notifications (user_id, category, title, body, link, read_at, archived_at, push_pending)
     values (?, ?, ?, ?, '/notifications', ?, ?, 1)`,
  ).run(uid, TEST_CATEGORY, title, body, now, now);
  kickNotifications();
  return { ok: true };
};

export const NOTIFICATION_READ_FUNCTIONS = ['my_notifications', 'notification_summary', 'notification_settings'];

export const notificationFunctions = {
  my_notifications,
  notification_summary,
  notifications_mark,
  notifications_archive,
  notification_settings,
  set_notification_channel,
  push_subscribe,
  push_unsubscribe,
  push_test,
};
