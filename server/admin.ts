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
  return c.json({ session_days_default: env.sessionDays });
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
