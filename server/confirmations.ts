// Confirmation emails to the people using the public forms: registration
// received, check-in recorded, and a welcome once a signed-up account is
// confirmed. Admins switch each kind on (Admin → Email); projects can turn
// their two kinds off again. Nothing typed into a public form appears in these
// emails — only names managers chose (project, page, Probe) — so the forms
// can't be used to send someone else arbitrary text.
import { createHash } from 'node:crypto';
import { db } from './db.ts';
import { env } from './env.ts';
import { branding } from './branding.ts';
import { instanceSettings } from './settings.ts';
import { mailEnabled, mailErrorCode, sendMail } from './mail.ts';

type Kind = 'registration' | 'checkin' | 'welcome';

// "Registration received" emails per address and day: enough for a family
// registering several people, too few to flood a stranger's inbox.
const REGISTRATION_DAILY_LIMIT = 3;
const DAY = 24 * 60 * 60 * 1000;

// One plain address: no lists, display names or whitespace that would make
// the mailer write to several recipients.
const SINGLE_ADDRESS_RE = /^[^\s@<>"(),;:\\]+@[^\s@<>"(),;:\\]+\.[^\s@<>"(),;:\\]+$/;

// Only a hash of the address is kept, enough to recognise repeats.
const addressHash = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

const alreadySent = (kind: Kind, ref: string) =>
  Boolean(db.prepare('select 1 from confirmation_log where kind = ? and ref = ?').get(kind, ref));

const sentSince = (kind: Kind, hash: string, since: Date) =>
  (
    db
      .prepare('select count(*) as n from confirmation_log where kind = ? and recipient_hash = ? and sent_at > ?')
      .get(kind, hash, since.toISOString()) as { n: number }
  ).n;

const record = (kind: Kind, ref: string | null, hash: string) =>
  db.prepare('insert into confirmation_log (kind, ref, recipient_hash) values (?, ?, ?)').run(kind, ref, hash);

// Runs `send` after the current request: RPC functions run in one transaction,
// and the email must only go out once it's committed. Called last, after all
// writes. Failures are logged (error code only, never the address) and never
// reach the visitor.
const later = (label: string, send: () => Promise<void>) =>
  setImmediate(() => {
    send().catch((err) => console.error(`Sending ${label} confirmation failed:`, mailErrorCode(err)));
  });

const appName = () => branding().appName;

const footer = [
  '',
  '—',
  'Diese E-Mail wurde automatisch verschickt. / This email was sent automatically.',
];

const formatDate = (date: string | null, time: string | null, locale: 'de-DE' | 'en-GB') => {
  if (!date) return '';
  const day = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return '';
  const text = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(day);
  return time ? `${text}, ${time.slice(0, 5)}` : text;
};

// After a public registration was saved (form or webhook).
export const queueRegistrationReceived = (pageId: string, email: string | null) => {
  if (!email || !SINGLE_ADDRESS_RE.test(email) || email.length > 254) return;
  later('registration', async () => {
    if (!instanceSettings().mailRegistrationReceived || !mailEnabled()) return;
    const page = db
      .prepare(
        `select rp.title, p.name as project_name, p.notify_registration_received
         from registration_pages rp join projects p on p.id = rp.project_id
         where rp.id = ?`,
      )
      .get(pageId) as { title: string; project_name: string; notify_registration_received: number } | undefined;
    if (!page?.notify_registration_received) return;

    const hash = addressHash(email);
    if (sentSince('registration', hash, new Date(Date.now() - DAY)) >= REGISTRATION_DAILY_LIMIT) return;
    record('registration', pageId, hash);

    await sendMail(
      email,
      `${appName()}: Anmeldung eingegangen / Registration received`,
      [
        'Hallo,',
        '',
        `deine Anmeldung „${page.title}“ für ${page.project_name} ist eingegangen. Vielen Dank!`,
        'Wenn du dich nicht angemeldet hast, kannst du diese E-Mail ignorieren.',
        '',
        'Hello,',
        '',
        `your registration "${page.title}" for ${page.project_name} has been received. Thank you!`,
        'If you didn’t register, you can ignore this email.',
        ...footer,
      ].join('\n'),
      'confirmation',
    );
  });
};

// After a check-in was recorded for a known member (account or recognised
// guest). Once per member and Probe; a second scan sends nothing.
export const queueCheckinConfirmation = (eventId: string, memberId: string, status: string) =>
  later('check-in', async () => {
    if (!instanceSettings().mailCheckinConfirmation || !mailEnabled()) return;
    const row = db
      .prepare(
        `select e.name as event_name, e.date, e.time, p.name as project_name, p.notify_checkin_confirmation,
                coalesce(au.email, m.email) as email
         from members m
         join events e on e.id = ?
         join projects p on p.id = e.project_id and p.id = m.project_id
         left join auth_users au on au.id = m.user_id
         where m.id = ?`,
      )
      .get(eventId, memberId) as
      | {
          event_name: string;
          date: string | null;
          time: string | null;
          project_name: string;
          notify_checkin_confirmation: number;
          email: string | null;
        }
      | undefined;
    if (!row?.notify_checkin_confirmation || !row.email || !SINGLE_ADDRESS_RE.test(row.email)) return;

    const ref = `${eventId}:${memberId}`;
    if (alreadySent('checkin', ref)) return;
    record('checkin', ref, addressHash(row.email));

    const excused = status === 'excused';
    const whenDe = formatDate(row.date, row.time, 'de-DE');
    const whenEn = formatDate(row.date, row.time, 'en-GB');
    await sendMail(
      row.email,
      `${appName()}: Check-in bestätigt / Check-in confirmed`,
      [
        'Hallo,',
        '',
        `dein Check-in für „${row.event_name}“ (${row.project_name}${whenDe ? `, ${whenDe}` : ''}) wurde erfasst.`,
        `Status: ${excused ? 'entschuldigt' : 'anwesend'}`,
        'Wenn du das nicht warst, wende dich bitte an die Projektleitung.',
        '',
        'Hello,',
        '',
        `your check-in for "${row.event_name}" (${row.project_name}${whenEn ? `, ${whenEn}` : ''}) was recorded.`,
        `Status: ${excused ? 'excused' : 'present'}`,
        'If this wasn’t you, please contact the project’s organisers.',
        ...footer,
      ].join('\n'),
      'confirmation',
    );
  });

// After a self sign-up confirmed its email address. Once per account.
export const queueSignupWelcome = (userId: string) =>
  later('welcome', async () => {
    if (!instanceSettings().mailSignupWelcome || !mailEnabled()) return;
    if (alreadySent('welcome', userId)) return;
    const row = db
      .prepare(
        `select au.email, coalesce(u.approved, 1) as approved
         from auth_users au left join app_users u on u.id = au.id where au.id = ?`,
      )
      .get(userId) as { email: string; approved: number } | undefined;
    if (!row) return;
    record('welcome', userId, addressHash(row.email));

    // Only the configured address: a link built from the request could be forged.
    const login = env.publicUrl ? `${env.publicUrl}/login` : null;
    const name = appName();
    await sendMail(
      row.email,
      `${name}: Willkommen / Welcome`,
      [
        'Hallo,',
        '',
        `dein Konto bei ${name} ist eingerichtet.`,
        row.approved
          ? `Du kannst dich jetzt anmelden${login ? `: ${login}` : '.'}`
          : 'Ein Admin muss es noch freigeben. Danach kannst du dich anmelden.',
        '',
        'Hello,',
        '',
        `your ${name} account is set up.`,
        row.approved
          ? `You can sign in now${login ? `: ${login}` : '.'}`
          : 'An admin still has to approve it. You can sign in after that.',
        ...footer,
      ].join('\n'),
      'account',
    );
  });
