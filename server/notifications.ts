// The notification engine. Everything that is worth telling someone ends up
// here and becomes a row in their notification center (`notifications`),
// plus a push message or an email when they chose that for the category
// (shared/notifications.ts lists the categories and their defaults):
//
//   1. Changes are recorded by triggers (and a few server calls, see
//      `enqueue`) in notification_queue. After a short, per-kind delay — so a
//      Probe edited three times in a row makes one notice — `processQueue`
//      finds the recipients and writes their notifications.
//   2. Time-based ones (reminders, the weekly overview, a survey that opened
//      or is about to close, a published concert or weekend, an open room
//      choice) are checked every few minutes; notification_marks makes each
//      go out once.
//   3. `deliver` sends what is pending as push messages and emails.
//
// Unread notifications with the same group key are merged ("3 new sign-ups")
// instead of piling up. Nobody is notified about their own changes.
//
// Event dates/times are wall-clock values interpreted in the server's time
// zone, so run the server with TZ set (e.g. Europe/Berlin).
import { db, nowIso, uuid } from './db.ts';
import { env } from './env.ts';
import { mailEnabled, mailErrorCode, sendMail } from './mail.ts';
import { branding } from './branding.ts';
import { defaultLanguage, formatWhen as formatDate, mailTexts } from './i18n.ts';
import type { MailTexts } from './locales/en.ts';
import { localeOf, toLanguage, type Language } from '../shared/languages.ts';
import {
  notificationCategory,
  type NotificationCategoryId,
  type NotificationChannel,
} from '../shared/notifications.ts';
import { sendPush } from './webpush.ts';
import { onEnqueue } from './notificationQueue.ts';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const QUEUE_INTERVAL = 15 * SECOND;
const SCHEDULE_INTERVAL = 5 * MINUTE;
const WEEKLY_HOUR = 7;
const NO_TIME_REMINDER_HOUR = 8;

type Data = Record<string, unknown>;

// A push test from the settings: never listed, removed once pushed.
export const TEST_CATEGORY = 'test';

// ---------------------------------------------------------------------------
// Recipients and their choices
// ---------------------------------------------------------------------------

interface Recipient {
  id: string;
  name: string;
  email: string;
  language: string | null;
  role: string;
  approved: number;
  email_confirmed_at: string | null;
}

const recipient = (userId: string) =>
  db
    .prepare(
      `select u.id, u.name, au.email, u.language, u.role, u.approved, au.email_confirmed_at
       from app_users u join auth_users au on au.id = u.id where u.id = ?`,
    )
    .get(userId) as Recipient | undefined;

const langOf = (r: Pick<Recipient, 'language'>): Language => toLanguage(r.language, defaultLanguage());

export const channelFor = (userId: string, category: string): NotificationChannel => {
  const row = db
    .prepare('select channel from notification_prefs where user_id = ? and category = ?')
    .get(userId, category) as { channel: NotificationChannel } | undefined;
  return row?.channel ?? notificationCategory(category)?.default ?? 'inapp';
};

const hasPushDevice = (userId: string) =>
  Boolean(db.prepare('select 1 from push_subscriptions where user_id = ? limit 1').get(userId));

export const unreadCount = (userId: string) =>
  (
    db
      .prepare('select count(*) as n from notifications where user_id = ? and read_at is null and archived_at is null')
      .get(userId) as { n: number }
  ).n;

// ---------------------------------------------------------------------------
// Making a notification
// ---------------------------------------------------------------------------

interface Notice<D extends Data> {
  category: NotificationCategoryId;
  projectId?: string | null;
  link: string | null;
  // Merges with an unread notification of the same key.
  groupKey?: string | null;
  data: D;
  // How the new data joins what an unread notification already holds;
  // without it the new data replaces the old.
  merge?: (previous: D, next: D) => D;
  render: (texts: MailTexts, lang: Language, data: D) => { title: string; body: string };
}

export const notify = <D extends Data>(userId: string, notice: Notice<D>) => {
  const r = recipient(userId);
  // Accounts waiting for approval only hear about their own account.
  if (!r || (!r.approved && notificationCategory(notice.category)?.area !== 'account')) return;
  const channel = channelFor(userId, notice.category);
  if (channel === 'off') return;
  const push = channel === 'push' && hasPushDevice(userId);
  const email = channel === 'email' && Boolean(r.email_confirmed_at) && mailEnabled();
  const lang = langOf(r);
  const texts = mailTexts(lang);

  const existing = notice.groupKey
    ? (db
        .prepare(
          `select id, data from notifications
           where user_id = ? and group_key = ? and read_at is null and archived_at is null
           order by created_at desc limit 1`,
        )
        .get(userId, notice.groupKey) as { id: string; data: string } | undefined)
    : undefined;

  if (existing) {
    const previous = JSON.parse(existing.data) as D;
    const data = notice.merge ? notice.merge(previous, notice.data) : notice.data;
    const { title, body } = notice.render(texts, lang, data);
    // An email went out (or is about to) for the unread one: no second email
    // until it's read; a push replaces the message on the device (same tag).
    db.prepare(
      `update notifications set title = ?, body = ?, link = ?, data = ?, count = count + 1, created_at = ?,
              push_pending = ? where id = ?`,
    ).run(title, body, notice.link, JSON.stringify(data), nowIso(), push ? 1 : 0, existing.id);
    return;
  }
  const { title, body } = notice.render(texts, lang, notice.data);
  db.prepare(
    `insert into notifications (id, user_id, category, project_id, group_key, title, body, link, data, push_pending, email_pending)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    uuid(),
    userId,
    notice.category,
    notice.projectId ?? null,
    notice.groupKey ?? null,
    title,
    body,
    notice.link,
    JSON.stringify(notice.data),
    push ? 1 : 0,
    email ? 1 : 0,
  );
};

// ---------------------------------------------------------------------------
// Who is concerned
// ---------------------------------------------------------------------------

interface ProjectRow {
  id: string;
  name: string;
  status: string;
  allow_account_access: number;
  allow_participant_pieces: number;
}

const projectRow = (projectId: string | null) =>
  projectId
    ? (db
        .prepare('select id, name, status, allow_account_access, allow_participant_pieces from projects where id = ?')
        .get(projectId) as ProjectRow | undefined)
    : undefined;

// Accounts taking part in the project (an active linked member row, and the
// project lets accounts in).
const participantsOf = (project: ProjectRow | undefined) => {
  if (!project || project.status !== 'active' || !project.allow_account_access) return [];
  return (
    db
      .prepare(
        `select distinct m.user_id from members m join app_users u on u.id = m.user_id
         where m.project_id = ? and m.status = 'active' and u.role <> 'music_director'`,
      )
      .all(project.id) as { user_id: string }[]
  ).map((r) => r.user_id);
};

const MANAGER_ROLES = `('section_lead', 'manager', 'music_director', 'admin')`;

// Those looking after the project: managing accounts that are part of it (a
// member, responsible for a group, or its creator); without any, Verwaltung
// and admins.
const managersOf = (project: ProjectRow | undefined) => {
  if (!project || project.status !== 'active') return [];
  const close = db
    .prepare(
      `select u.id from app_users u where u.role in ${MANAGER_ROLES} and (
         exists (select 1 from members m where m.project_id = @p and m.user_id = u.id and m.status = 'active')
         or exists (select 1 from group_responsibles r join project_groups g on g.id = r.group_id
                    where g.project_id = @p and r.user_id = u.id)
         or exists (select 1 from projects p where p.id = @p and p.created_by = u.id))`,
    )
    .all({ p: project.id }) as { id: string }[];
  const rows = close.length
    ? close
    : (db.prepare(`select id from app_users where role in ('manager', 'admin')`).all() as { id: string }[]);
  return rows.map((r) => r.id);
};

const isManager = (userId: string) =>
  Boolean(db.prepare(`select 1 from app_users where id = ? and role in ${MANAGER_ROLES}`).get(userId));

const except = (ids: string[], ...skip: Array<string | null | undefined>) => ids.filter((id) => !skip.includes(id));

// ---------------------------------------------------------------------------
// Wording helpers
// ---------------------------------------------------------------------------

const when = (lang: Language, date: string | null, time: string | null) =>
  formatDate(lang, date, time, { weekday: 'short', day: 'numeric', month: 'short' });

const dateTime = (lang: Language, iso: string) =>
  new Intl.DateTimeFormat(localeOf(lang), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

const memberInfo = (memberId: string) => {
  const m = db
    .prepare('select first_name, last_name, group_name, user_id from members where id = ?')
    .get(memberId) as
    | { first_name: string; last_name: string; group_name: string | null; user_id: string | null }
    | undefined;
  return m ? { name: `${m.first_name} ${m.last_name}`.trim(), group: m.group_name, userId: m.user_id } : null;
};

const sumN = <D extends { n: number }>(a: D, b: D): D => ({ ...b, n: a.n + b.n });
const unionNames = <D extends { names: string[] }>(a: D, b: D): D => ({
  ...b,
  names: [...new Set([...a.names, ...b.names])],
});

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

interface QueueRow {
  id: number;
  kind: string;
  ref: string;
  project_id: string | null;
  actor_id: string | null;
  data: string;
  created_at: string;
}

const dataOf = (row: QueueRow) => JSON.parse(row.data || '{}') as Data;
const actors = (rows: QueueRow[]) => rows.map((r) => r.actor_id);

interface EventRow {
  id: string;
  project_id: string;
  name: string;
  date: string;
  time: string | null;
  location: string | null;
}

const eventRow = (id: string) =>
  db.prepare('select id, project_id, name, date, time, location from events where id = ?').get(id) as
    | EventRow
    | undefined;

const participationLink = (projectId: string) => `/projects/${projectId}/participation`;

// What happened, by kind: how long to wait for more of the same (a Probe
// edited several times, a member changing their mind) and what to do then.
const HANDLERS: Record<string, { wait: number; run: (rows: QueueRow[]) => void }> = {
  event_new: {
    wait: MINUTE,
    run: (rows) => {
      const event = eventRow(rows[0].ref);
      const project = projectRow(event?.project_id ?? null);
      if (!event || !project) return;
      for (const userId of except(participantsOf(project), ...actors(rows))) {
        notify(userId, {
          category: 'event_new',
          projectId: project.id,
          link: participationLink(project.id),
          groupKey: `event_new:${project.id}`,
          data: { n: 1, event: event.name, date: event.date, time: event.time },
          merge: sumN,
          render: (t, lang, d) => t.notify.event_new(d.n, d.event, project.name, when(lang, d.date, d.time)),
        });
      }
    },
  },

  event_changed: {
    wait: 5 * MINUTE,
    run: (rows) => {
      const event = eventRow(rows[0].ref);
      const project = projectRow(event?.project_id ?? null);
      if (!event || !project) return;
      for (const userId of except(participantsOf(project), ...actors(rows))) {
        notify(userId, {
          category: 'event_changed',
          projectId: project.id,
          link: participationLink(project.id),
          groupKey: `event:${event.id}`,
          data: {},
          render: (t, lang) =>
            t.notify.event_changed(event.name, project.name, when(lang, event.date, event.time), event.location),
        });
      }
    },
  },

  event_cancelled: {
    wait: 30 * SECOND,
    run: (rows) => {
      const row = rows[rows.length - 1];
      const project = projectRow(row.project_id);
      if (!project) return;
      const d = dataOf(row) as { name: string; date: string; time: string | null };
      for (const userId of except(participantsOf(project), row.actor_id)) {
        notify(userId, {
          category: 'event_cancelled',
          projectId: project.id,
          link: participationLink(project.id),
          data: {},
          render: (t, lang) => t.notify.event_cancelled(d.name, project.name, when(lang, d.date, d.time)),
        });
      }
    },
  },

  // Someone else marked a member excused/absent: the latest change per
  // member, if it still stands.
  attendance_changed: {
    wait: 2 * MINUTE,
    run: (rows) => {
      const event = eventRow(rows[0].ref);
      const project = projectRow(event?.project_id ?? null);
      if (!event || !project || project.status !== 'active') return;
      const latest = new Map<string, Data>();
      for (const row of rows) latest.set(String(dataOf(row).member_id), dataOf(row));
      for (const d of latest.values()) {
        const current = db
          .prepare(
            `select a.status, m.user_id from attendance a join members m on m.id = a.member_id
             where a.event_id = ? and a.member_id = ?`,
          )
          .get(event.id, String(d.member_id)) as { status: string; user_id: string | null } | undefined;
        if (!current?.user_id || current.status !== d.status) continue;
        notify(current.user_id, {
          category: 'attendance_changed',
          projectId: project.id,
          link: participationLink(project.id),
          groupKey: `attendance:${event.id}`,
          data: {},
          render: (t, lang) =>
            t.notify.attendance_changed(
              event.name,
              project.name,
              when(lang, event.date, event.time),
              current.status === 'excused',
            ),
        });
      }
    },
  },

  // Members who excused themselves, for the people responsible for their
  // group.
  group_absence: {
    wait: 2 * MINUTE,
    run: (rows) => {
      const event = eventRow(rows[0].ref);
      const project = projectRow(event?.project_id ?? null);
      if (!event || !project || project.status !== 'active') return;
      for (const memberId of new Set(rows.map((r) => String(dataOf(r).member_id)))) {
        const still = db
          .prepare(`select 1 from attendance where event_id = ? and member_id = ? and status = 'excused'`)
          .get(event.id, memberId);
        const member = memberInfo(memberId);
        if (!still || !member?.group) continue;
        const group = member.group;
        const responsibles = db
          .prepare(
            `select distinct r.user_id from group_responsibles r join project_groups g on g.id = r.group_id
             where g.project_id = ? and g.name = ?`,
          )
          .all(project.id, group) as { user_id: string }[];
        for (const { user_id: userId } of responsibles) {
          if (userId === member.userId) continue;
          notify(userId, {
            category: 'group_absence',
            projectId: project.id,
            link: isManager(userId) ? `/projects/${project.id}/events/${event.id}` : participationLink(project.id),
            groupKey: `group_absence:${event.id}:${group}`,
            data: { names: [member.name] },
            merge: unionNames,
            render: (t, lang, d) =>
              t.notify.group_absence(d.names, event.name, when(lang, event.date, event.time), group),
          });
        }
      }
    },
  },

  project_added: {
    wait: 30 * SECOND,
    run: (rows) => {
      const member = db
        .prepare(`select project_id, user_id from members where id = ? and status = 'active'`)
        .get(rows[0].ref) as { project_id: string; user_id: string | null } | undefined;
      const project = projectRow(member?.project_id ?? null);
      if (!member?.user_id || !project || project.status !== 'active' || !project.allow_account_access) return;
      notify(member.user_id, {
        category: 'project_added',
        projectId: project.id,
        link: `/projects/${project.id}`,
        data: {},
        render: (t) => t.notify.project_added(project.name),
      });
    },
  },

  project_info: {
    wait: 10 * MINUTE,
    run: (rows) => {
      const project = projectRow(rows[0].ref);
      if (!project) return;
      for (const userId of except(participantsOf(project), ...actors(rows))) {
        notify(userId, {
          category: 'project_info',
          projectId: project.id,
          link: participationLink(project.id),
          groupKey: `project_info:${project.id}`,
          data: {},
          render: (t) => t.notify.project_info(project.name),
        });
      }
    },
  },

  piece_added: {
    wait: MINUTE,
    run: (rows) => {
      const row = rows[0];
      const project = projectRow(row.project_id);
      const piece = db.prepare('select id, name from pieces where id = ? and not archived').get(row.ref) as
        | { id: string; name: string }
        | undefined;
      const stillThere = db
        .prepare('select 1 from project_pieces where project_id = ? and piece_id = ?')
        .get(row.project_id, row.ref);
      if (!project || !piece || !stillThere || !project.allow_participant_pieces) return;
      for (const userId of except(participantsOf(project), ...actors(rows))) {
        notify(userId, {
          category: 'piece_added',
          projectId: project.id,
          link: `/projects/${project.id}/pieces/${piece.id}`,
          groupKey: `piece_added:${project.id}`,
          data: { n: 1, piece: piece.name },
          merge: sumN,
          render: (t, _lang, d) => t.notify.piece_added(d.n, d.piece, project.name),
        });
      }
    },
  },

  registration_new: {
    wait: 30 * SECOND,
    run: (rows) => {
      const page = db.prepare('select id, project_id, title from registration_pages where id = ?').get(rows[0].ref) as
        | { id: string; project_id: string; title: string }
        | undefined;
      const project = projectRow(page?.project_id ?? null);
      if (!page || !project) return;
      for (const userId of except(managersOf(project), ...actors(rows))) {
        notify(userId, {
          category: 'registration_new',
          projectId: project.id,
          link: `/projects/${project.id}/registrations/${page.id}`,
          groupKey: `registration:${page.id}`,
          data: { n: rows.length },
          merge: sumN,
          render: (t, _lang, d) => t.notify.registration_new(d.n, page.title, project.name),
        });
      }
    },
  },

  checkin_unrecognized: {
    wait: 30 * SECOND,
    run: (rows) => {
      const event = eventRow(rows[0].ref);
      const project = projectRow(event?.project_id ?? null);
      if (!event || !project) return;
      for (const userId of except(managersOf(project), ...actors(rows))) {
        notify(userId, {
          category: 'checkin_unrecognized',
          projectId: project.id,
          link: `/projects/${project.id}/events/${event.id}/check-in`,
          groupKey: `checkin:${event.id}`,
          data: { n: rows.length },
          merge: sumN,
          render: (t, _lang, d) => t.notify.checkin_unrecognized(d.n, event.name, project.name),
        });
      }
    },
  },

  account_role: {
    wait: 30 * SECOND,
    run: (rows) => {
      const user = db.prepare('select id, role from app_users where id = ?').get(rows[0].ref) as
        | { id: string; role: string }
        | undefined;
      if (!user) return;
      notify(user.id, {
        category: 'account_role',
        link: '/',
        groupKey: 'account_role',
        data: {},
        render: (t) => t.notify.account_role(t.roleNames[user.role] ?? user.role),
      });
    },
  },

  signup_pending: {
    wait: 0,
    run: (rows) => {
      const user = db.prepare('select id, name, email, approved from app_users where id = ?').get(rows[0].ref) as
        | { id: string; name: string; email: string; approved: number }
        | undefined;
      if (!user || user.approved) return;
      const admins = db.prepare(`select id from app_users where role = 'admin'`).all() as { id: string }[];
      for (const { id } of admins) {
        notify(id, {
          category: 'signup_pending',
          link: '/admin/users',
          groupKey: 'signup_pending',
          data: { names: [user.name || user.email] },
          merge: unionNames,
          render: (t, _lang, d) => t.notify.signup_pending(d.names),
        });
      }
    },
  },

  security_login: {
    wait: 0,
    run: (rows) => {
      for (const row of rows) {
        const d = dataOf(row) as { device?: string | null };
        notify(row.ref, {
          category: 'security_login',
          link: '/account/security',
          data: {},
          render: (t, lang) => t.notify.security_login(d.device || t.unknownDevice, dateTime(lang, row.created_at)),
        });
      }
    },
  },

  security_change: {
    wait: 0,
    run: (rows) => {
      for (const row of rows) {
        const what = dataOf(row).what as 'password' | 'email' | 'mfa_added' | 'mfa_removed';
        notify(row.ref, {
          category: 'security_change',
          link: '/account/security',
          data: {},
          render: (t) => t.notify.security_change(what),
        });
      }
    },
  },
};

const processQueue = (now: number) => {
  const groups = db
    .prepare(
      `select kind, ref, max(id) as last_id, max(created_at) as last_at
       from notification_queue group by kind, ref`,
    )
    .all() as { kind: string; ref: string; last_id: number; last_at: string }[];
  for (const group of groups) {
    const handler = HANDLERS[group.kind];
    if (handler && Date.parse(group.last_at) > now - handler.wait) continue;
    db.transaction(() => {
      const rows = db
        .prepare('select * from notification_queue where kind = ? and ref = ? and id <= ? order by id')
        .all(group.kind, group.ref, group.last_id) as QueueRow[];
      try {
        handler?.run(rows);
      } catch (err) {
        // A broken item must not block the queue.
        console.error(`Notification ${group.kind} failed:`, err);
      }
      db.prepare('delete from notification_queue where kind = ? and ref = ? and id <= ?').run(
        group.kind,
        group.ref,
        group.last_id,
      );
    })();
  }
};

// ---------------------------------------------------------------------------
// Scheduled checks
// ---------------------------------------------------------------------------

const marked = (kind: string, ref: string, userId = '') =>
  Boolean(
    db.prepare('select 1 from notification_marks where kind = ? and ref = ? and user_id = ?').get(kind, ref, userId),
  );

const mark = (kind: string, ref: string, userId = '') =>
  db.prepare('insert or ignore into notification_marks (kind, ref, user_id) values (?, ?, ?)').run(kind, ref, userId);

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ISO 8601 week, e.g. "2026-W39".
const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / DAY + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};

type UpcomingRow = EventRow & { user_id: string; project_name: string; status: string | null };

// Upcoming Proben of the accounts' active projects, with their status.
const upcomingEvents = (fromDate: string, toDate: string) =>
  db
    .prepare(
      `select m.user_id, e.id, e.project_id, p.name as project_name, e.name, e.date, e.time, e.location,
              a.status
       from members m
       join app_users u on u.id = m.user_id and u.approved and u.role <> 'music_director'
       join projects p on p.id = m.project_id and p.allow_account_access and p.status = 'active'
       join events e on e.project_id = m.project_id and e.date between ? and ?
       left join attendance a on a.event_id = e.id and a.member_id = m.id
       where m.status = 'active'
       order by e.date, e.time`,
    )
    .all(fromDate, toDate) as UpcomingRow[];

// Once, from 24 h before a Probe (no time set: the morning before).
const remind = (now: Date) => {
  for (const e of upcomingEvents(isoDate(now), isoDate(new Date(now.getTime() + 2 * DAY)))) {
    if (e.status === 'excused' || marked('event_reminder', e.id, e.user_id)) continue;
    const start = new Date(`${e.date}T${e.time ?? '00:00'}`);
    const from = e.time
      ? new Date(start.getTime() - DAY)
      : new Date(new Date(`${e.date}T00:00`).getTime() - DAY + NO_TIME_REMINDER_HOUR * HOUR);
    const end = e.time ? start : new Date(`${e.date}T23:59`);
    if (now < from || now >= end) continue;
    mark('event_reminder', e.id, e.user_id);
    notify(e.user_id, {
      category: 'event_reminder',
      projectId: e.project_id,
      link: participationLink(e.project_id),
      data: {},
      render: (t, lang) => t.notify.event_reminder(e.name, e.project_name, when(lang, e.date, e.time)),
    });
  }
};

// Monday morning: this week's Proben.
const weekly = (now: Date) => {
  if (now.getDay() !== 1 || now.getHours() < WEEKLY_HOUR) return;
  const week = isoWeek(now);
  const byUser = new Map<string, UpcomingRow[]>();
  for (const e of upcomingEvents(isoDate(now), isoDate(new Date(now.getTime() + 6 * DAY)))) {
    byUser.set(e.user_id, [...(byUser.get(e.user_id) ?? []), e]);
  }
  for (const [userId, events] of byUser) {
    if (marked('weekly_overview', week, userId)) continue;
    mark('weekly_overview', week, userId);
    notify(userId, {
      category: 'weekly_overview',
      link: '/',
      data: {},
      render: (t, lang) =>
        t.notify.weekly_overview(
          events.map((e) => {
            const status =
              e.status === 'excused' ? ` – ${t.weeklyExcused}` : e.status === 'attended' ? ` – ${t.weeklyPresent}` : '';
            return `• ${when(lang, e.date, e.time)}: ${e.name} (${e.project_name})${status}`;
          }),
        ),
    });
  }
};

// forms.ts and weekends.ts import modules that import this one (rpc.ts);
// they are loaded when the schedule first runs, after start-up.
interface ScheduleDeps {
  openFormsFor: typeof import('./forms.ts').openFormsFor;
  roomMissing: typeof import('./weekends.ts').roomMissing;
}

// Surveys that opened (once per survey) and that close within a day (once
// per account), for participants who haven't answered.
const surveys = (now: Date, { openFormsFor }: ScheduleDeps) => {
  const forms = db
    .prepare(
      `select f.id, f.project_id, f.title, f.token, f.closes_at from forms f
       join projects p on p.id = f.project_id
       where f.status = 'published' and f.listed and not f.archived and f.version_id is not null
         and p.status = 'active' and p.allow_account_access and p.show_surveys
         and (f.opens_at is null or f.opens_at <= @now) and (f.closes_at is null or f.closes_at > @now)`,
    )
    .all({ now: now.toISOString() }) as {
    id: string;
    project_id: string;
    title: string;
    token: string;
    closes_at: string | null;
  }[];
  for (const form of forms) {
    const project = projectRow(form.project_id);
    const opened = !marked('survey_new', form.id);
    const closesAt = form.closes_at;
    const closing = closesAt !== null && Date.parse(closesAt) - now.getTime() < DAY;
    if (!project || (!opened && !closing)) continue;
    if (opened) mark('survey_new', form.id);
    for (const userId of participantsOf(project)) {
      const mine = openFormsFor(userId, project.id).find((f) => f.form_id === form.id);
      if (!mine || mine.my === 'answered') continue;
      if (opened) {
        notify(userId, {
          category: 'survey_new',
          projectId: project.id,
          link: `/f/${form.token}`,
          groupKey: `survey:${form.id}`,
          data: {},
          render: (t, lang) =>
            t.notify.survey_new(form.title, project.name, closesAt ? dateTime(lang, closesAt) : null),
        });
      } else if (closesAt && !marked('survey_deadline', form.id, userId)) {
        mark('survey_deadline', form.id, userId);
        notify(userId, {
          category: 'survey_deadline',
          projectId: project.id,
          link: `/f/${form.token}`,
          groupKey: `survey:${form.id}`,
          data: {},
          render: (t, lang) => t.notify.survey_deadline(form.title, project.name, dateTime(lang, closesAt)),
        });
      }
    }
  }
};

const concerts = (now: Date) => {
  const rows = db
    .prepare(
      `select c.id, c.project_id, c.title, c.date, c.time from concerts c join projects p on p.id = c.project_id
       where c.status = 'published' and not c.archived and p.show_concerts and (c.date is null or c.date >= ?)`,
    )
    .all(isoDate(now)) as { id: string; project_id: string; title: string; date: string | null; time: string | null }[];
  for (const c of rows) {
    if (marked('concert_published', c.id)) continue;
    mark('concert_published', c.id);
    const project = projectRow(c.project_id);
    if (!project) continue;
    for (const userId of participantsOf(project)) {
      notify(userId, {
        category: 'concert_published',
        projectId: project.id,
        link: `/projects/${project.id}/concerts/${c.id}`,
        data: {},
        render: (t, lang) => t.notify.concert_published(c.title, project.name, when(lang, c.date, c.time)),
      });
    }
  }
};

const weekends = ({ roomMissing }: ScheduleDeps) => {
  const rows = db
    .prepare(
      `select w.id, w.project_id, w.title, w.starts_on, w.details_published, w.rooms_status
       from weekends w join projects p on p.id = w.project_id
       where not w.archived and p.show_weekend and (w.details_published or w.rooms_status = 'open')`,
    )
    .all() as {
    id: string;
    project_id: string;
    title: string;
    starts_on: string | null;
    details_published: number;
    rooms_status: string;
  }[];
  for (const w of rows) {
    const project = projectRow(w.project_id);
    if (!project) continue;
    if (w.details_published && !marked('weekend_published', w.id)) {
      mark('weekend_published', w.id);
      for (const userId of participantsOf(project)) {
        notify(userId, {
          category: 'weekend_published',
          projectId: project.id,
          link: `/projects/${project.id}/weekend/${w.id}`,
          data: {},
          render: (t, lang) => t.notify.weekend_published(w.title, project.name, when(lang, w.starts_on, null)),
        });
      }
    }
    if (w.rooms_status === 'open' && !marked('weekend_rooms', w.id)) {
      mark('weekend_rooms', w.id);
      const people = db
        .prepare('select distinct user_id from weekend_participants where weekend_id = ? and user_id is not null')
        .all(w.id) as { user_id: string }[];
      for (const { user_id: userId } of people) {
        if (!roomMissing(w.id, userId)) continue;
        notify(userId, {
          category: 'weekend_rooms',
          projectId: project.id,
          link: `/projects/${project.id}/weekend/${w.id}/rooms`,
          data: {},
          render: (t) => t.notify.weekend_rooms(w.title, project.name),
        });
      }
    }
  }
};

// Old notifications go away by themselves: done or read ones after half a
// year, everything after two years.
const cleanUp = () => {
  db.prepare(
    `delete from notifications where (created_at < ? and (archived_at is not null or read_at is not null))
       or created_at < ?`,
  ).run(new Date(Date.now() - 183 * DAY).toISOString(), new Date(Date.now() - 730 * DAY).toISOString());
  db.prepare(`delete from notification_marks where user_id <> '' and created_at < ?`).run(
    new Date(Date.now() - 400 * DAY).toISOString(),
  );
};

const runSchedule = (now: Date, deps: ScheduleDeps) => {
  const steps: Array<[string, () => void]> = [
    ['reminders', () => remind(now)],
    ['weekly', () => weekly(now)],
    ['surveys', () => surveys(now, deps)],
    ['concerts', () => concerts(now)],
    ['weekends', () => weekends(deps)],
    ['clean-up', cleanUp],
  ];
  for (const [name, step] of steps) {
    try {
      db.transaction(step)();
    } catch (err) {
      console.error(`Scheduled notifications (${name}) failed:`, err);
    }
  }
};

// ---------------------------------------------------------------------------
// Delivery: push and email
// ---------------------------------------------------------------------------

interface PendingRow {
  id: string;
  user_id: string;
  category: string;
  group_key: string | null;
  title: string;
  body: string;
  link: string | null;
  created_at: string;
  push_pending: number;
  email_pending: number;
}

const absolute = (path: string | null) => (path && env.publicUrl ? `${env.publicUrl}${path}` : null);

const pushOne = async (n: PendingRow) => {
  const devices = db
    .prepare('select id, endpoint, p256dh, auth from push_subscriptions where user_id = ?')
    .all(n.user_id) as { id: string; endpoint: string; p256dh: string; auth: string }[];
  const message = {
    title: n.title,
    body: n.body,
    link: n.link ?? '/notifications',
    tag: n.group_key ?? n.id,
    id: n.id,
    unread: unreadCount(n.user_id),
  };
  for (const device of devices) {
    const result = await sendPush(device, message);
    if (result === 'gone') db.prepare('delete from push_subscriptions where id = ?').run(device.id);
    if (result === 'sent') {
      db.prepare('update push_subscriptions set last_used_at = ? where id = ?').run(nowIso(), device.id);
    }
  }
};

const emailOne = async (n: PendingRow) => {
  const r = recipient(n.user_id);
  if (!r?.email_confirmed_at) return true;
  const texts = mailTexts(langOf(r));
  const link = absolute(n.link);
  const lines = [
    texts.greeting(r.name || undefined),
    '',
    n.title,
    ...(n.body ? ['', n.body] : []),
    ...(link ? ['', link] : []),
    '',
    '—',
    texts.notificationEmailFooter(absolute('/account/notifications')),
  ];
  try {
    await sendMail(r.email, `${branding().appName}: ${n.title}`, lines.join('\n'), 'notification');
    return true;
  } catch (err) {
    // The account id, not the address: logs shouldn't collect recipients.
    console.error(`Sending a notification to account ${n.user_id} failed:`, mailErrorCode(err));
    return false;
  }
};

const deliver = async () => {
  const pending = db
    .prepare('select * from notifications where push_pending or email_pending order by created_at limit 200')
    .all() as PendingRow[];
  for (const n of pending) {
    if (n.push_pending) {
      // Best effort: a push that can't be delivered now is not retried.
      db.prepare('update notifications set push_pending = 0 where id = ?').run(n.id);
      await pushOne(n);
      if (n.category === TEST_CATEGORY) db.prepare('delete from notifications where id = ?').run(n.id);
    }
    if (n.email_pending) {
      const done = !mailEnabled() || (await emailOne(n));
      // Retried on the next runs, for a day at most.
      if (done || Date.parse(n.created_at) < Date.now() - DAY) {
        db.prepare('update notifications set email_pending = 0 where id = ?').run(n.id);
      }
    }
  }
};

// ---------------------------------------------------------------------------

let running = false;
let again = false;
let lastSchedule = 0;

export const runNotifications = async (now = new Date()) => {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    processQueue(now.getTime());
    if (now.getTime() - lastSchedule >= SCHEDULE_INTERVAL) {
      lastSchedule = now.getTime();
      const [{ openFormsFor }, { roomMissing }] = await Promise.all([import('./forms.ts'), import('./weekends.ts')]);
      runSchedule(now, { openFormsFor, roomMissing });
    }
    await deliver();
  } catch (err) {
    console.error('Notification run failed:', err);
  } finally {
    running = false;
  }
  if (again) {
    again = false;
    void runNotifications();
  }
};

// Soon, outside the current request (its transaction must be done).
let kicked = false;
export const kickNotifications = () => {
  if (kicked) return;
  kicked = true;
  setTimeout(() => {
    kicked = false;
    void runNotifications();
  }, 500).unref();
};

export const startNotifications = () => {
  onEnqueue(kickNotifications);
  setTimeout(() => void runNotifications(), 10 * SECOND).unref();
  setInterval(() => void runNotifications(), QUEUE_INTERVAL).unref();
};
