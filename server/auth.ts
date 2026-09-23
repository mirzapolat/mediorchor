// Authentication: email + password accounts, cookie sessions, optional email
// confirmation (when SMTP is configured) and TOTP two-factor authentication.
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { db, asUser, nowIso, uuid, ApiError } from './db.ts';
import { env, mailEnabled } from './env.ts';
import { sendConfirmEmailChange, sendConfirmSignup } from './mail.ts';
import { rateLimit } from './ratelimit.ts';

const COOKIE = 'mo_session';
const DAY = 24 * 60 * 60 * 1000;
const MIN_PASSWORD = 8;

export interface SessionUser {
  id: string;
  email: string;
}

// ---------------------------------------------------------------------------
// Passwords (scrypt)
// ---------------------------------------------------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

const scryptAsync = (password: string, salt: Buffer, N: number, r: number, p: number, keylen: number) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );

export const hashPassword = async (password: string) => {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
};

const verifyPassword = async (password: string, stored: string) => {
  const [scheme, N, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scryptAsync(password, Buffer.from(salt, 'base64'), +N, +r, +p, expected.length);
  return timingSafeEqual(key, expected);
};

// Used to keep response times equal for unknown emails.
const DUMMY_HASH = await hashPassword(randomBytes(12).toString('hex'));

export const validatePassword = (password: unknown): string => {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new ApiError(`Password should be at least ${MIN_PASSWORD} characters.`, 422, 'weak_password');
  }
  if (password.length > 1024) throw new ApiError('Password is too long', 422, 'weak_password');
  return password;
};

export const normalizeEmail = (email: unknown): string => {
  const value = typeof email === 'string' ? email.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254) {
    throw new ApiError('Unable to validate email address: invalid format', 400, 'email_address_invalid');
  }
  return value;
};

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

const emailTaken = (email: string, exceptUserId?: string) =>
  Boolean(
    db
      .prepare('select 1 from auth_users where email = ? collate nocase and id is not ?')
      .get(email, exceptUserId ?? null),
  );

// Creates the auth user plus its app_users profile in one transaction.
export const createAccount = async (opts: {
  email: string;
  password: string;
  name: string;
  confirmed: boolean;
  isAdmin?: boolean;
}) => {
  const email = normalizeEmail(opts.email);
  const passwordHash = await hashPassword(validatePassword(opts.password));
  const id = uuid();
  db.transaction(() => {
    if (emailTaken(email)) {
      throw new ApiError('A user with this email address has already been registered', 422, 'email_exists');
    }
    db.prepare(
      'insert into auth_users (id, email, password_hash, email_confirmed_at) values (?, ?, ?, ?)',
    ).run(id, email, passwordHash, opts.confirmed ? nowIso() : null);
    db.prepare('insert into app_users (id, email, name, is_admin) values (?, ?, ?, ?)').run(
      id,
      email,
      opts.name.trim().slice(0, 200),
      opts.isAdmin ? 1 : 0,
    );
  })();
  return id;
};

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

const isHttps = (c: Context) =>
  c.req.header('x-forwarded-proto') === 'https' || new URL(c.req.url).protocol === 'https:';

const startSession = (c: Context, userId: string) => {
  const token = newToken();
  const expires = new Date(Date.now() + env.sessionDays * DAY);
  db.prepare('insert into auth_sessions (token_hash, user_id, expires_at) values (?, ?, ?)').run(
    sha256(token),
    userId,
    expires.toISOString(),
  );
  db.prepare('update auth_users set last_seen_at = ? where id = ?').run(nowIso(), userId);
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isHttps(c),
    path: '/',
    maxAge: env.sessionDays * 24 * 60 * 60,
  });
};

// How stale auth_users.last_seen_at may get before a request refreshes it;
// keeps "last seen" accurate enough without a write on every request.
const LAST_SEEN_INTERVAL = 5 * 60 * 1000;

// Resolves the session cookie to a user. Sessions slide: they are extended
// once less than half of their lifetime is left.
export const sessionUser = (c: Context): SessionUser | null => {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const hash = sha256(token);
  const row = db
    .prepare(
      `select s.expires_at, u.id, u.email, u.last_seen_at from auth_sessions s
       join auth_users u on u.id = s.user_id
       where s.token_hash = ?`,
    )
    .get(hash) as
    | { expires_at: string; id: string; email: string; last_seen_at: string | null }
    | undefined;
  if (!row) return null;
  const expiresAt = Date.parse(row.expires_at);
  if (expiresAt <= Date.now()) {
    db.prepare('delete from auth_sessions where token_hash = ?').run(hash);
    return null;
  }
  if (expiresAt - Date.now() < (env.sessionDays * DAY) / 2) {
    const renewed = new Date(Date.now() + env.sessionDays * DAY).toISOString();
    db.prepare('update auth_sessions set expires_at = ? where token_hash = ?').run(renewed, hash);
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: isHttps(c),
      path: '/',
      maxAge: env.sessionDays * 24 * 60 * 60,
    });
  }
  if (!row.last_seen_at || Date.now() - Date.parse(row.last_seen_at) > LAST_SEEN_INTERVAL) {
    db.prepare('update auth_users set last_seen_at = ? where id = ?').run(nowIso(), row.id);
  }
  return { id: row.id, email: row.email };
};

export const requireSession = (c: Context): SessionUser => {
  const user = sessionUser(c);
  if (!user) throw new ApiError('Not authenticated', 401, 'not_authenticated');
  return user;
};

export const purgeExpired = () => {
  const now = nowIso();
  db.prepare('delete from auth_sessions where expires_at <= ?').run(now);
  db.prepare('delete from auth_tokens where expires_at <= ?').run(now);
};

// ---------------------------------------------------------------------------
// TOTP (RFC 6238, SHA-1, 6 digits, 30 s)
// ---------------------------------------------------------------------------

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const base32Encode = (buffer: Buffer) => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
};

const base32Decode = (input: string) => {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32.indexOf(ch);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

const hotp = (secret: Buffer, counter: number) => {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
};

// Returns the matched time step (±1 step of drift), or null.
const verifyTotp = (secret: string, code: string, lastStep: number | null) => {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const key = base32Decode(secret);
  const current = Math.floor(Date.now() / 30_000);
  for (const step of [current - 1, current, current + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = hotp(key, step);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return step;
  }
  return null;
};

const verifiedFactor = (userId: string) =>
  db
    .prepare(`select id, secret, last_step from auth_factors where user_id = ? and status = 'verified'`)
    .get(userId) as { id: string; secret: string; last_step: number | null } | undefined;

const useFactorCode = (factor: { id: string; secret: string; last_step: number | null }, code: string) => {
  const step = verifyTotp(factor.secret, code, factor.last_step);
  if (step === null) throw new ApiError('Invalid TOTP code entered', 422, 'mfa_verification_failed');
  db.prepare('update auth_factors set last_step = ? where id = ?').run(step, factor.id);
};

// ---------------------------------------------------------------------------
// Email links
// ---------------------------------------------------------------------------

const baseUrl = (c: Context) => {
  if (env.publicUrl) return env.publicUrl;
  const url = new URL(c.req.url);
  const proto = c.req.header('x-forwarded-proto') ?? url.protocol.replace(':', '');
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? url.host;
  return `${proto}://${host}`;
};

const issueLink = (c: Context, userId: string, kind: 'confirm_signup' | 'email_change', email: string) => {
  const token = newToken();
  db.prepare('delete from auth_tokens where user_id = ? and kind = ?').run(userId, kind);
  db.prepare('insert into auth_tokens (token_hash, user_id, kind, email, expires_at) values (?, ?, ?, ?, ?)').run(
    sha256(token),
    userId,
    kind,
    email,
    new Date(Date.now() + DAY).toISOString(),
  );
  return `${baseUrl(c)}/api/auth/confirm?token=${token}`;
};

// ---------------------------------------------------------------------------
// Routes (/api/auth)
// ---------------------------------------------------------------------------

const body = async (c: Context) => {
  try {
    const data = await c.req.json();
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const sessionPayload = (user: SessionUser | null) => ({ session: user ? { user } : null });

export const authRoutes = new Hono();

authRoutes.get('/session', (c) => c.json(sessionPayload(sessionUser(c))));

authRoutes.post('/login', async (c) => {
  rateLimit(c, 'login', 20, 15 * 60 * 1000);
  const { email, password, code } = await body(c);
  if (typeof email !== 'string' || typeof password !== 'string') {
    throw new ApiError('Invalid login credentials', 400, 'invalid_credentials');
  }
  const user = db
    .prepare('select id, email, password_hash, email_confirmed_at from auth_users where email = ? collate nocase')
    .get(email.trim()) as
    | { id: string; email: string; password_hash: string; email_confirmed_at: string | null }
    | undefined;
  const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !valid) throw new ApiError('Invalid login credentials', 400, 'invalid_credentials');
  if (!user.email_confirmed_at) throw new ApiError('Email not confirmed', 400, 'email_not_confirmed');

  const factor = verifiedFactor(user.id);
  if (factor) {
    if (typeof code !== 'string' || !code.trim()) return c.json({ mfa_required: true, session: null });
    useFactorCode(factor, code);
  }

  startSession(c, user.id);
  return c.json(sessionPayload({ id: user.id, email: user.email }));
});

authRoutes.post('/logout', (c) => {
  const token = getCookie(c, COOKIE);
  if (token) db.prepare('delete from auth_sessions where token_hash = ?').run(sha256(token));
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

authRoutes.post('/signup', async (c) => {
  rateLimit(c, 'signup', 10, 60 * 60 * 1000);
  const settings = db.prepare('select allow_self_signup from app_settings where id = 1').get() as
    | { allow_self_signup: number }
    | undefined;
  if (settings && !settings.allow_self_signup) {
    throw new ApiError('Signups not allowed for this instance', 403, 'signup_disabled');
  }

  const input = await body(c);
  const email = normalizeEmail(input.email);
  const password = validatePassword(input.password);
  const name = typeof input.name === 'string' ? input.name : '';

  const existing = db
    .prepare('select id, email_confirmed_at from auth_users where email = ? collate nocase')
    .get(email) as { id: string; email_confirmed_at: string | null } | undefined;

  if (!mailEnabled) {
    // No mail server: accounts are confirmed right away.
    if (existing) throw new ApiError('User already registered', 422, 'user_already_exists');
    const id = await createAccount({ email, password, name, confirmed: true });
    startSession(c, id);
    return c.json(sessionPayload({ id, email }));
  }

  // With confirmation on, never reveal whether an address is registered.
  if (existing) {
    if (!existing.email_confirmed_at) await sendConfirmSignup(email, issueLink(c, existing.id, 'confirm_signup', email));
    return c.json(sessionPayload(null));
  }
  const id = await createAccount({ email, password, name, confirmed: false });
  try {
    await sendConfirmSignup(email, issueLink(c, id, 'confirm_signup', email));
  } catch (err) {
    console.error('Sending confirmation email failed:', err);
    db.prepare('delete from auth_users where id = ?').run(id);
    throw new ApiError('Error sending confirmation email', 500, 'email_send_failed');
  }
  return c.json(sessionPayload(null));
});

// Target of the emailed links. Signs the user in and returns to the app.
authRoutes.get('/confirm', (c) => {
  const token = c.req.query('token') ?? '';
  const row = db
    .prepare('select user_id, kind, email, expires_at from auth_tokens where token_hash = ?')
    .get(sha256(token)) as { user_id: string; kind: string; email: string; expires_at: string } | undefined;
  if (!row || Date.parse(row.expires_at) <= Date.now()) return c.redirect('/login');

  let target = '/';
  const ok = db.transaction(() => {
    db.prepare('delete from auth_tokens where token_hash = ?').run(sha256(token));
    if (row.kind === 'email_change') {
      if (emailTaken(row.email, row.user_id)) return false;
      db.prepare('update auth_users set email = ?, email_confirmed_at = ? where id = ?').run(
        row.email,
        nowIso(),
        row.user_id,
      );
      db.prepare('update app_users set email = ? where id = ?').run(row.email, row.user_id);
      target = '/account';
    } else {
      db.prepare('update auth_users set email_confirmed_at = coalesce(email_confirmed_at, ?) where id = ?').run(
        nowIso(),
        row.user_id,
      );
    }
    return true;
  })();
  if (!ok) return c.redirect('/login');
  // A second factor still has to be entered on the login page.
  if (!verifiedFactor(row.user_id)) startSession(c, row.user_id);
  return c.redirect(target);
});

// Change the own email and/or password.
authRoutes.patch('/user', async (c) => {
  const user = requireSession(c);
  const input = await body(c);
  let emailChangePending = false;

  if (input.password !== undefined) {
    const passwordHash = await hashPassword(validatePassword(input.password));
    db.prepare('update auth_users set password_hash = ? where id = ?').run(passwordHash, user.id);
    // Sign out every other device.
    const token = getCookie(c, COOKIE) ?? '';
    db.prepare('delete from auth_sessions where user_id = ? and token_hash <> ?').run(user.id, sha256(token));
  }

  if (input.email !== undefined) {
    const email = normalizeEmail(input.email);
    if (email !== user.email) {
      if (emailTaken(email, user.id)) {
        throw new ApiError('A user with this email address has already been registered', 422, 'email_exists');
      }
      if (mailEnabled) {
        await sendConfirmEmailChange(email, issueLink(c, user.id, 'email_change', email));
        emailChangePending = true;
      } else {
        db.transaction(() => {
          db.prepare('update auth_users set email = ? where id = ?').run(email, user.id);
          db.prepare('update app_users set email = ? where id = ?').run(email, user.id);
        })();
      }
    }
  }

  return c.json({ ...sessionPayload(requireSession(c)), email_change_pending: emailChangePending });
});

// Delete the own account after re-entering the password (and, with 2FA, a
// current code). Deleting the auth user cascades to the profile, sessions,
// tokens, 2FA and project scope; linked member rows keep their attendance
// history and are just unlinked.
authRoutes.delete('/user', async (c) => {
  rateLimit(c, 'delete-account', 10, 15 * 60 * 1000);
  const user = requireSession(c);
  const { password, code } = await body(c);

  // Never leave the instance without an administrator.
  const { me, others } = db
    .prepare(
      `select coalesce(sum(id = @id), 0) as me, coalesce(sum(id <> @id), 0) as others
       from app_users where is_admin`,
    )
    .get({ id: user.id }) as { me: number; others: number };
  if (me && !others) {
    throw new ApiError('The last administrator cannot delete their account', 400, 'last_admin');
  }

  const row = db.prepare('select password_hash from auth_users where id = ?').get(user.id) as
    | { password_hash: string }
    | undefined;
  if (!row || typeof password !== 'string' || !(await verifyPassword(password, row.password_hash))) {
    throw new ApiError('Invalid password', 400, 'invalid_credentials');
  }

  const factor = verifiedFactor(user.id);
  if (factor) {
    if (typeof code !== 'string' || !code.trim()) {
      throw new ApiError('A two-factor code is required', 400, 'mfa_required');
    }
    useFactorCode(factor, code.trim());
  }

  db.prepare('delete from auth_users where id = ?').run(user.id);
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

// --- two-factor -------------------------------------------------------------

authRoutes.get('/mfa/factors', (c) => {
  const user = requireSession(c);
  const factors = db
    .prepare('select id, status, created_at from auth_factors where user_id = ? order by created_at')
    .all(user.id) as { id: string; status: string; created_at: string }[];
  return c.json({ totp: factors.map((f) => ({ ...f, factor_type: 'totp' })) });
});

authRoutes.post('/mfa/enroll', (c) => {
  const user = requireSession(c);
  if (verifiedFactor(user.id)) throw new ApiError('Two-factor authentication is already enabled', 422);
  const secret = base32Encode(randomBytes(20));
  const id = uuid();
  db.transaction(() => {
    db.prepare(`delete from auth_factors where user_id = ? and status = 'unverified'`).run(user.id);
    db.prepare('insert into auth_factors (id, user_id, secret) values (?, ?, ?)').run(id, user.id, secret);
  })();
  const issuer = env.client.VITE_APP_NAME;
  const label = encodeURIComponent(`${issuer}:${user.email}`);
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  return c.json({ id, factor_type: 'totp', totp: { secret, uri } });
});

authRoutes.post('/mfa/verify', async (c) => {
  rateLimit(c, 'mfa', 20, 15 * 60 * 1000);
  const user = requireSession(c);
  const { factorId, code } = await body(c);
  const factor = db
    .prepare('select id, secret, last_step from auth_factors where id = ? and user_id = ?')
    .get(String(factorId ?? ''), user.id) as { id: string; secret: string; last_step: number | null } | undefined;
  if (!factor) throw new ApiError('Factor not found', 404, 'mfa_factor_not_found');
  useFactorCode(factor, String(code ?? ''));
  db.prepare(`update auth_factors set status = 'verified' where id = ?`).run(factor.id);
  return c.json({ ok: true });
});

authRoutes.post('/mfa/unenroll', async (c) => {
  const user = requireSession(c);
  const { factorId } = await body(c);
  db.prepare('delete from auth_factors where id = ? and user_id = ?').run(String(factorId ?? ''), user.id);
  return c.json({ ok: true });
});

// Runs an authenticated handler body as the session's user (see db.asUser).
export const withSessionUser = <T>(c: Context, fn: (user: SessionUser | null) => T): T => {
  const user = sessionUser(c);
  return asUser(user?.id ?? null, () => fn(user));
};
