// Account administration (formerly the admin-create-user / admin-delete-user
// edge functions). Admin only; reachable as /api/functions/<name>.
import { Hono, type Context } from 'hono';
import { db, ApiError, forbidden } from './db.ts';
import { createAccount, requireSession } from './auth.ts';
import { activeSmtpConfig, mailStatus, testSmtp, type SmtpConfig, type SmtpSecurity } from './mail.ts';
import { encryptSecret } from './secrets.ts';
import { env } from './env.ts';
import { rateLimit } from './ratelimit.ts';

const requireAdmin = (c: Context) => {
  const user = requireSession(c);
  const row = db.prepare('select is_admin from app_users where id = ?').get(user.id) as
    | { is_admin: number }
    | undefined;
  if (!row?.is_admin) throw forbidden('Forbidden: admin only');
  return user;
};

export const adminRoutes = new Hono();

// Creates an account that is already email-confirmed.
adminRoutes.post('/admin-create-user', async (c) => {
  requireAdmin(c);
  const { name, email, password } = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!email || !password) throw new ApiError('email and password are required', 400);
  const id = await createAccount({
    email: String(email),
    password: String(password),
    name: typeof name === 'string' ? name : '',
    confirmed: true,
  });
  return c.json({ id });
});

// Deleting the auth user cascades to the profile, sessions and project scope;
// linked member rows keep their history and are just unlinked.
adminRoutes.post('/admin-delete-user', async (c) => {
  const me = requireAdmin(c);
  const { userId } = (await c.req.json().catch(() => ({}))) as { userId?: unknown };
  if (typeof userId !== 'string' || !userId) throw new ApiError('userId is required', 400);
  if (userId === me.id) throw new ApiError('You cannot delete yourself', 400);

  const target = db.prepare('select is_admin from app_users where id = ?').get(userId) as
    | { is_admin: number }
    | undefined;
  if (target?.is_admin) throw new ApiError('Cannot delete an admin', 400);

  const { changes } = db.prepare('delete from auth_users where id = ?').run(userId);
  if (!changes) throw new ApiError('User not found', 404);
  return c.json({ ok: true });
});

// Server facts the admin config shows: the session length the environment
// defaults to.
adminRoutes.post('/admin-server-info', (c) => {
  requireAdmin(c);
  return c.json({
    session_days_default: env.sessionDays,
    // Branding defaults from the environment, for the Branding card's placeholders.
    brand_defaults: { app_name: env.client.VITE_APP_NAME, accent_color: env.client.VITE_ACCENT_COLOR },
  });
});

// ---------------------------------------------------------------------------
// SMTP (Admin Config → Email). The password is write-only: it's stored
// encrypted and never returned, only whether one is set.
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@<>"(),;:\\]+@[^\s@<>"(),;:\\]+\.[^\s@<>"(),;:\\]+$/;
const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$|^\[?[0-9A-Fa-f:.]+\]?$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const SECURITY: SmtpSecurity[] = ['tls', 'starttls', 'none'];
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const bad = (message: string, code = 'smtp_invalid') => new ApiError(message, 400, code);

const text = (value: unknown, field: string, max: number, required: boolean) => {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    if (required) throw bad(`${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw bad(`${field} must be text`);
  const trimmed = value.trim();
  // Line breaks would allow header injection.
  if (trimmed.length > max || CONTROL_RE.test(trimmed)) throw bad(`${field} is invalid`);
  return trimmed;
};

// Validates the form and resolves the password: a new one, none (null), or —
// left empty — the one in effect now. The stored password is only reused for
// the same server and user, so it can't be sent to a different host.
const smtpInput = (body: Record<string, unknown>): SmtpConfig => {
  const host = text(body.host, 'Server', 253, true)!.toLowerCase();
  if (!HOST_RE.test(host)) throw bad('Server is not a valid host name');
  const port = Number(body.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw bad('Port must be 1–65535');
  const security = body.security as SmtpSecurity;
  if (!SECURITY.includes(security)) throw bad('Invalid encryption');
  const user = text(body.username, 'User', 254, false);
  const from = text(body.from_address, 'Sender address', 254, true)!;
  if (!EMAIL_RE.test(from)) throw bad('Sender address is not a valid email address');
  const fromName = text(body.from_name, 'Sender name', 120, false);

  let pass: string | undefined;
  if (typeof body.password === 'string' && body.password !== '') {
    if (body.password.length > 1024 || /[\r\n]/.test(body.password)) throw bad('Password is invalid');
    pass = body.password;
  } else if (body.password !== null && user) {
    const current = activeSmtpConfig();
    if (current?.pass && current.host.toLowerCase() === host && current.user === user) pass = current.pass;
    else if (current?.pass) throw bad('Enter the password again when changing server or user', 'smtp_password_reentry');
  }
  if (pass && !user) throw bad('A password needs a user');
  if (pass && security === 'none' && !LOCAL_HOSTS.has(host)) {
    throw bad('Use TLS or STARTTLS to send a password to a remote server', 'smtp_insecure_auth');
  }
  return { host, port, security, user, pass, from, fromName };
};

adminRoutes.post('/admin-smtp-get', (c) => {
  requireAdmin(c);
  return c.json(mailStatus());
});

adminRoutes.post('/admin-smtp-save', async (c) => {
  const me = requireAdmin(c);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const config = smtpInput(body);
  db.prepare(
    `insert into smtp_settings
       (id, host, port, security, username, password_enc, from_address, from_name, updated_at, updated_by)
     values (1, @host, @port, @security, @username, @password_enc, @from_address, @from_name, now_iso(), @updated_by)
     on conflict (id) do update set
       host = excluded.host, port = excluded.port, security = excluded.security,
       username = excluded.username, password_enc = excluded.password_enc,
       from_address = excluded.from_address, from_name = excluded.from_name,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).run({
    host: config.host,
    port: config.port,
    security: config.security,
    username: config.user ?? null,
    password_enc: config.pass ? encryptSecret(config.pass) : null,
    from_address: config.from,
    from_name: config.fromName ?? null,
    updated_by: me.id,
  });
  console.log(`SMTP settings updated by account ${me.id}`);
  return c.json(mailStatus());
});

// Removes the saved settings (and password); the environment applies again.
adminRoutes.post('/admin-smtp-delete', (c) => {
  const me = requireAdmin(c);
  db.prepare('delete from smtp_settings where id = 1').run();
  console.log(`SMTP settings removed by account ${me.id}`);
  return c.json(mailStatus());
});

// Checks the form's settings (saved or not) against the server and, with a
// recipient, sends a test email. Rate-limited: it opens outbound connections.
adminRoutes.post('/admin-smtp-test', async (c) => {
  const me = requireAdmin(c);
  rateLimit(c, 'smtp-test', 10, 60_000);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const config = smtpInput(body);
  let to: string | undefined;
  if (body.send) {
    to = typeof body.to === 'string' && body.to.trim() ? body.to.trim() : me.email;
    if (!EMAIL_RE.test(to) || to.length > 254) throw bad('Invalid email address');
  }
  try {
    await testSmtp(config, to);
  } catch (err) {
    throw new ApiError(err instanceof Error ? err.message : String(err), 502, 'mail_send_failed');
  }
  return c.json({ ok: true, to: to ?? null });
});

// ---------------------------------------------------------------------------
// Email sending statistics (Admin → Email). Aggregates only: mail_log holds no
// recipients or content.
// ---------------------------------------------------------------------------

const MAIL_KINDS = ['account', 'reminder', 'status', 'weekly', 'test'] as const;
const RANGES = {
  '7d': { days: 7, bucket: 'day' },
  '30d': { days: 30, bucket: 'day' },
  '90d': { days: 90, bucket: 'day' },
  '12m': { days: 365, bucket: 'month' },
} as const;

adminRoutes.post('/admin-mail-stats', async (c) => {
  requireAdmin(c);
  const body = (await c.req.json().catch(() => ({}))) as { range?: unknown; tz_offset?: unknown };
  const range =
    typeof body.range === 'string' && Object.hasOwn(RANGES, body.range) ? (body.range as keyof typeof RANGES) : '30d';
  const { days, bucket } = RANGES[range];
  // Minutes to add to UTC for the viewer's local time (−getTimezoneOffset()).
  const offset = Math.max(-14 * 60, Math.min(14 * 60, Math.round(Number(body.tz_offset) || 0)));

  // Bucket keys in local time: YYYY-MM-DD or YYYY-MM.
  const local = (d: Date) => new Date(d.getTime() + offset * 60_000);
  const keyOf = (d: Date) => local(d).toISOString().slice(0, bucket === 'day' ? 10 : 7);
  const now = new Date();
  const keys: string[] = [];
  if (bucket === 'day') {
    for (let i = days - 1; i >= 0; i--) keys.push(keyOf(new Date(now.getTime() - i * 86_400_000)));
  } else {
    const l = local(now);
    for (let i = 11; i >= 0; i--) {
      const m = new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth() - i, 1));
      keys.push(m.toISOString().slice(0, 7));
    }
  }
  // Start of the first bucket, in UTC.
  const startLocal = bucket === 'day' ? `${keys[0]}T00:00:00.000Z` : `${keys[0]}-01T00:00:00.000Z`;
  const since = new Date(Date.parse(startLocal) - offset * 60_000);
  const span = now.getTime() - since.getTime();
  const previousSince = new Date(since.getTime() - span);

  const fmt = bucket === 'day' ? '%Y-%m-%d' : '%Y-%m';
  const rows = db
    .prepare(
      `select strftime('${fmt}', sent_at, ? || ' minutes') as bucket, kind, ok, count(*) as n
       from mail_log where sent_at >= ?
       group by bucket, kind, ok`,
    )
    .all(`${offset >= 0 ? '+' : ''}${offset}`, since.toISOString()) as { bucket: string; kind: string; ok: number; n: number }[];

  const empty = () => Object.fromEntries(MAIL_KINDS.map((k) => [k, 0])) as Record<string, number>;
  const byKey = new Map(keys.map((k) => [k, { key: k, sent: empty(), failed: 0 }]));
  const totals = { sent: 0, failed: 0, by_kind: empty(), failed_by_kind: empty() };
  for (const r of rows) {
    const b = byKey.get(r.bucket);
    if (!b) continue;
    if (r.ok) {
      b.sent[r.kind] = (b.sent[r.kind] ?? 0) + r.n;
      totals.sent += r.n;
      totals.by_kind[r.kind] = (totals.by_kind[r.kind] ?? 0) + r.n;
    } else {
      b.failed += r.n;
      totals.failed += r.n;
      totals.failed_by_kind[r.kind] = (totals.failed_by_kind[r.kind] ?? 0) + r.n;
    }
  }

  const previous = db
    .prepare(
      `select coalesce(sum(ok), 0) as sent, coalesce(sum(1 - ok), 0) as failed
       from mail_log where sent_at >= ? and sent_at < ?`,
    )
    .get(previousSince.toISOString(), since.toISOString()) as { sent: number; failed: number };
  const lastSent = db.prepare('select sent_at from mail_log where ok order by sent_at desc limit 1').get() as
    | { sent_at: string }
    | undefined;
  const lastFailed = db
    .prepare('select sent_at, error from mail_log where not ok order by sent_at desc limit 1')
    .get() as { sent_at: string; error: string | null } | undefined;
  const recentErrors = db
    .prepare(
      `select error, count(*) as n from mail_log where not ok and sent_at >= ?
       group by error order by n desc limit 5`,
    )
    .all(since.toISOString()) as { error: string | null; n: number }[];

  return c.json({
    range,
    bucket,
    kinds: MAIL_KINDS,
    buckets: [...byKey.values()],
    totals,
    previous,
    last_sent_at: lastSent?.sent_at ?? null,
    last_failed: lastFailed ? { at: lastFailed.sent_at, error: lastFailed.error } : null,
    errors: recentErrors.map((e) => ({ error: e.error ?? 'UNKNOWN', count: e.n })),
  });
});
