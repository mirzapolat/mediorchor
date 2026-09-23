// Account administration (formerly the admin-create-user / admin-delete-user
// edge functions). Admin only; reachable as /api/functions/<name>.
import { Hono, type Context } from 'hono';
import { db, ApiError, forbidden } from './db.ts';
import { createAccount, requireSession } from './auth.ts';

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
