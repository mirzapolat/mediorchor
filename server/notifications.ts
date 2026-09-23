// Email notifications members opt into on their account page:
//   reminder  once, from 24 h before a Probe (no time set: the morning before)
//   status    someone else marked them excused/absent (after a short debounce)
//   weekly    Monday morning: this week's Proben and their status
// Runs every few minutes while SMTP is configured. notification_log makes each
// mail go out once; a failed send is simply retried on the next run.
//
// Event dates/times are wall-clock values; they're interpreted in the
// server's time zone, so run the server with TZ set (e.g. Europe/Berlin).
import { db } from './db.ts';
import { env, mailEnabled } from './env.ts';
import { sendMail } from './mail.ts';

type Lang = 'de' | 'en';

const HOUR = 60 * 60 * 1000;
const INTERVAL = 5 * 60 * 1000;
const STATUS_DEBOUNCE = 2 * 60 * 1000;
const WEEKLY_HOUR = 7;
const NO_TIME_REMINDER_HOUR = 8;

interface Recipient {
  user_id: string;
  email: string;
  name: string;
  language: string | null;
}

interface EventRow {
  id: string;
  project_id: string;
  project_name: string;
  name: string;
  date: string;
  time: string | null;
  description: string | null;
}

const lang = (r: Recipient): Lang =>
  (r.language ?? env.client.VITE_DEFAULT_LANGUAGE) === 'de' ? 'de' : 'en';

const appName = () => env.client.VITE_APP_NAME;

const eventStart = (e: Pick<EventRow, 'date' | 'time'>) => new Date(`${e.date}T${e.time ?? '00:00'}`);

const formatWhen = (e: Pick<EventRow, 'date' | 'time'>, l: Lang) => {
  const date = new Date(`${e.date}T00:00`).toLocaleDateString(l === 'de' ? 'de-DE' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return e.time ? `${date}, ${e.time}${l === 'de' ? ' Uhr' : ''}` : date;
};

const participationLink = (projectId: string) =>
  env.publicUrl ? `${env.publicUrl}/projects/${projectId}/participation` : null;

const footer = (l: Lang) =>
  l === 'de'
    ? ['', '—', 'Du erhältst diese E-Mail, weil du Benachrichtigungen in deinem Konto aktiviert hast.']
    : ['', '—', 'You receive this email because you turned on notifications in your account.'];

const wasSent = (userId: string, kind: string, ref: string) =>
  Boolean(db.prepare('select 1 from notification_log where user_id = ? and kind = ? and ref = ?').get(userId, kind, ref));

const markSent = (userId: string, kind: string, ref: string) =>
  db.prepare('insert or ignore into notification_log (user_id, kind, ref) values (?, ?, ?)').run(userId, kind, ref);

const deliver = async (r: Recipient, kind: string, ref: string, subject: string, lines: string[]) => {
  try {
    await sendMail(r.email, `${appName()}: ${subject}`, [...lines, ...footer(lang(r))].join('\n'));
    markSent(r.user_id, kind, ref);
  } catch (err) {
    console.error(`Sending ${kind} notification to ${r.email} failed:`, err);
  }
};

// Accounts that opted into `column`, with their active participations.
const recipientsWith = (column: 'notify_reminders' | 'notify_weekly' | 'notify_status') =>
  db
    .prepare(
      `select u.id as user_id, au.email, u.name, u.language
       from app_users u join auth_users au on au.id = u.id
       where u.${column} and u.approved and au.email_confirmed_at is not null`,
    )
    .all() as Recipient[];

// Upcoming Proben of the account's active projects with its status (if any).
const eventsFor = (userId: string, fromDate: string, toDate: string) =>
  db
    .prepare(
      `select e.id, e.project_id, p.name as project_name, e.name, e.date, e.time, e.description,
              a.status
       from members m
       join projects p on p.id = m.project_id and p.allow_account_access and p.status = 'active'
       join events e on e.project_id = m.project_id and e.date between ? and ?
       left join attendance a on a.event_id = e.id and a.member_id = m.id
       where m.user_id = ? and m.status = 'active'
       order by e.date, e.time`,
    )
    .all(fromDate, toDate, userId) as (EventRow & { status: string | null })[];

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ---------------------------------------------------------------------------

const sendReminders = async (now: Date) => {
  const today = isoDate(now);
  const inTwoDays = isoDate(new Date(now.getTime() + 48 * HOUR));
  for (const r of recipientsWith('notify_reminders')) {
    for (const e of eventsFor(r.user_id, today, inTwoDays)) {
      if (e.status === 'excused' || wasSent(r.user_id, 'reminder', e.id)) continue;
      const start = eventStart(e);
      const from = e.time
        ? new Date(start.getTime() - 24 * HOUR)
        : new Date(new Date(`${e.date}T00:00`).getTime() - 24 * HOUR + NO_TIME_REMINDER_HOUR * HOUR);
      const end = e.time ? start : new Date(`${e.date}T23:59`);
      if (now < from || now >= end) continue;
      const l = lang(r);
      const link = participationLink(e.project_id);
      await deliver(
        r,
        'reminder',
        e.id,
        l === 'de' ? `Erinnerung: ${e.name}` : `Reminder: ${e.name}`,
        l === 'de'
          ? [
              `Hallo ${r.name || ''},`.replace(' ,', ','),
              '',
              `bald ist ${e.name} (${e.project_name}):`,
              formatWhen(e, l),
              ...(e.description ? ['', e.description] : []),
              '',
              'Falls du nicht kommen kannst, gib bitte rechtzeitig Bescheid.',
              ...(link ? ['', link] : []),
            ]
          : [
              `Hello ${r.name || ''},`.replace(' ,', ','),
              '',
              `${e.name} (${e.project_name}) is coming up:`,
              formatWhen(e, l),
              ...(e.description ? ['', e.description] : []),
              '',
              "If you can't make it, please let us know in time.",
              ...(link ? ['', link] : []),
            ],
      );
    }
  }
};

const sendStatusNotices = async (now: Date) => {
  const cutoff = new Date(now.getTime() - STATUS_DEBOUNCE).toISOString();
  // Latest change per account and Probe that has settled for the debounce.
  const pending = db
    .prepare(
      `select o.id, o.user_id, o.event_id, o.status from notification_outbox o
       where o.created_at <= ? and o.id = (
         select max(id) from notification_outbox x where x.user_id = o.user_id and x.event_id = o.event_id
       )`,
    )
    .all(cutoff) as { id: number; user_id: string; event_id: string; status: string }[];

  const optedIn = new Map(recipientsWith('notify_status').map((r) => [r.user_id, r]));
  for (const p of pending) {
    const r = optedIn.get(p.user_id);
    const e = db
      .prepare(
        `select e.id, e.project_id, p.name as project_name, e.name, e.date, e.time, e.description, a.status
         from events e join projects p on p.id = e.project_id
         join members m on m.project_id = e.project_id and m.user_id = ?
         left join attendance a on a.event_id = e.id and a.member_id = m.id
         where e.id = ?`,
      )
      .get(p.user_id, p.event_id) as (EventRow & { status: string | null }) | undefined;
    // Only when the change still stands (not reverted within the debounce).
    if (r && e && e.status === p.status && !wasSent(r.user_id, 'status', String(p.id))) {
      const l = lang(r);
      const statusText =
        p.status === 'excused'
          ? l === 'de' ? 'entschuldigt' : 'excused'
          : l === 'de' ? 'abwesend' : 'absent';
      const link = participationLink(e.project_id);
      await deliver(
        r,
        'status',
        String(p.id),
        l === 'de' ? `Anwesenheit geändert: ${e.name}` : `Attendance changed: ${e.name}`,
        l === 'de'
          ? [
              `Hallo ${r.name || ''},`.replace(' ,', ','),
              '',
              `du wurdest für ${e.name} (${e.project_name}${e.date ? `, ${formatWhen(e, l)}` : ''}) als ${statusText} eingetragen.`,
              '',
              'Falls das nicht stimmt, wende dich bitte an die Projektleitung.',
              ...(link ? ['', link] : []),
            ]
          : [
              `Hello ${r.name || ''},`.replace(' ,', ','),
              '',
              `you were marked ${statusText} for ${e.name} (${e.project_name}${e.date ? `, ${formatWhen(e, l)}` : ''}).`,
              '',
              "If that's not right, please contact the project management.",
              ...(link ? ['', link] : []),
            ],
      );
    }
  }
  db.prepare('delete from notification_outbox where created_at <= ?').run(cutoff);
};

// ISO 8601 week, e.g. "2026-W39".
const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};

const sendWeekly = async (now: Date) => {
  if (now.getDay() !== 1 || now.getHours() < WEEKLY_HOUR) return;
  const week = isoWeek(now);
  const monday = isoDate(now);
  const sunday = isoDate(new Date(now.getTime() + 6 * 24 * HOUR));
  for (const r of recipientsWith('notify_weekly')) {
    if (wasSent(r.user_id, 'weekly', week)) continue;
    const events = eventsFor(r.user_id, monday, sunday);
    if (events.length === 0) {
      markSent(r.user_id, 'weekly', week); // nothing this week, nothing to send
      continue;
    }
    const l = lang(r);
    const statusLabel = (s: string | null) =>
      s === 'excused' ? (l === 'de' ? ' – entschuldigt' : ' – excused')
        : s === 'attended' ? (l === 'de' ? ' – als anwesend eingetragen' : ' – marked present')
          : '';
    const lines = events.map((e) => `• ${formatWhen(e, l)}: ${e.name} (${e.project_name})${statusLabel(e.status)}`);
    await deliver(
      r,
      'weekly',
      week,
      l === 'de' ? 'Deine Proben diese Woche' : 'Your rehearsals this week',
      l === 'de'
        ? [`Hallo ${r.name || ''},`.replace(' ,', ','), '', 'diese Woche stehen an:', '', ...lines]
        : [`Hello ${r.name || ''},`.replace(' ,', ','), '', 'This week:', '', ...lines],
    );
  }
};

let running = false;

export const runNotifications = async (now = new Date()) => {
  if (!mailEnabled || running) return;
  running = true;
  try {
    await sendStatusNotices(now);
    await sendReminders(now);
    await sendWeekly(now);
  } catch (err) {
    console.error('Notification run failed:', err);
  } finally {
    running = false;
  }
};

export const startNotifications = () => {
  if (!mailEnabled) return;
  setTimeout(() => void runNotifications(), 30_000).unref();
  setInterval(() => void runNotifications(), INTERVAL).unref();
};
