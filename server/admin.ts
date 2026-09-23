// Account administration (formerly the admin-create-user / admin-delete-user
// edge functions). Admin only; reachable as /api/functions/<name>.
import { Hono, type Context } from 'hono';
import { db, ApiError, forbidden } from './db.ts';
import { createAccount, requireSession } from './auth.ts';
import { mailStatus, sendTestMail } from './mail.ts';
import { env } from './env.ts';

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

// Server facts the admin config shows: email setup (never the password) and
// the session length the environment defaults to.
adminRoutes.post('/admin-server-info', (c) => {
  requireAdmin(c);
  return c.json({ mail: mailStatus(), session_days_default: env.sessionDays });
});

// Sends a test email, by default to the admin's own address.
adminRoutes.post('/admin-send-test-mail', async (c) => {
  const me = requireAdmin(c);
  if (!mailStatus().configured) throw new ApiError('Email is not configured', 400, 'mail_not_configured');
  const { to } = (await c.req.json().catch(() => ({}))) as { to?: unknown };
  const target = typeof to === 'string' && to.trim() ? to.trim() : me.email;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) throw new ApiError('Invalid email address', 400);
  try {
    await sendTestMail(target);
  } catch (err) {
    throw new ApiError(`Sending failed: ${err instanceof Error ? err.message : String(err)}`, 502, 'mail_send_failed');
  }
  return c.json({ ok: true, to: target });
});
