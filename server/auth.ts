// Authentication: email + password accounts, cookie sessions, optional email
// confirmation (when SMTP is configured), two-factor authentication
// (authenticator app, passkeys, email codes; see mfa.ts) and passkey sign-in.
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { db, asUser, nowIso, uuid, ApiError } from './db.ts';
import { env } from './env.ts';
import { branding } from './branding.ts';
import { mailEnabled, sendConfirmEmailChange, sendConfirmSignup, sendPendingSignupNotice } from './mail.ts';
import { rateLimit } from './ratelimit.ts';
import { instanceSettings, emailDomainAllowed } from './settings.ts';
import {
  base32Encode,
  createChallenge,
  email2faAvailable,
  factorSummary,
  getChallenge,
  hasSecondFactor,
  mfaMethods,
  passkeyAuthenticationOptions,
  passkeyRegistrationOptions,
  purgeChallenges,
  registerPasskey,
  sendChallengeEmail,
  setEmail2fa,
  useTotpCode,
  verifiedTotp,
  verifyPasskeyLogin,
  verifyProof,
  type Challenge,
} from './mfa.ts';

const COOKIE = 'mo_session';
const DAY = 24 * 60 * 60 * 1000;
const MIN_PASSWORD = 8;

export interface SessionUser {
  id: string;
  email: string;
  sessionId?: string; // the current device's session (auth_sessions.id)
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
  // false = self sign-up waiting for admin approval.
  approved?: boolean;
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
    db.prepare('insert into app_users (id, email, name, is_admin, approved) values (?, ?, ?, ?, ?)').run(
      id,
      email,
      opts.name.trim().slice(0, 200),
      opts.isAdmin ? 1 : 0,
      opts.approved === false ? 0 : 1,
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

const setSessionCookie = (c: Context, token: string, days: number) =>
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isHttps(c),
    path: '/',
    maxAge: days * 24 * 60 * 60,
  });

// verified: the user just proved who they are (password, second factor or
// passkey), which counts as a recent sign-in (see requireRecentAuth).
const startSession = (c: Context, userId: string, verified: boolean) => {
  const token = newToken();
  const days = instanceSettings().sessionDays;
  const now = nowIso();
  db.prepare(
    `insert into auth_sessions (token_hash, user_id, expires_at, id, user_agent, last_seen_at, reauth_at)
     values (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sha256(token),
    userId,
    new Date(Date.now() + days * DAY).toISOString(),
    randomBytes(16).toString('hex'),
    (c.req.header('user-agent') ?? '').slice(0, 300) || null,
    now,
    verified ? now : null,
  );
  db.prepare('update auth_users set last_seen_at = ? where id = ?').run(now, userId);
  setSessionCookie(c, token, days);
};

// How stale last_seen_at (account and session) may get before a request
// refreshes it; keeps "last seen" accurate enough without a write per request.
const LAST_SEEN_INTERVAL = 5 * 60 * 1000;

// Resolves the session cookie to a user. Sessions slide: they are extended
// once less than half of their lifetime is left, and shortened when the
// admin lowered the session length. Accounts awaiting approval have none.
export const sessionUser = (c: Context): SessionUser | null => {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const hash = sha256(token);
  const row = db
    .prepare(
      `select s.id as session_id, s.expires_at, s.last_seen_at as session_seen_at,
              u.id, u.email, u.last_seen_at, coalesce(a.approved, 1) as approved
       from auth_sessions s
       join auth_users u on u.id = s.user_id
       left join app_users a on a.id = u.id
       where s.token_hash = ?`,
    )
    .get(hash) as
    | {
        session_id: string;
        expires_at: string;
        session_seen_at: string | null;
        id: string;
        email: string;
        last_seen_at: string | null;
        approved: number;
      }
    | undefined;
  if (!row) return null;
  const now = Date.now();
  const expiresAt = Date.parse(row.expires_at);
  if (expiresAt <= now || !row.approved) {
    db.prepare('delete from auth_sessions where token_hash = ?').run(hash);
    return null;
  }
  const days = instanceSettings().sessionDays;
  const lifetime = days * DAY;
  if (expiresAt - now < lifetime / 2 || expiresAt - now > lifetime) {
    const renewed = new Date(now + lifetime).toISOString();
    db.prepare('update auth_sessions set expires_at = ? where token_hash = ?').run(renewed, hash);
    setSessionCookie(c, token, days);
  }
  const stale = (iso: string | null) => !iso || now - Date.parse(iso) > LAST_SEEN_INTERVAL;
  if (stale(row.session_seen_at)) {
    db.prepare('update auth_sessions set last_seen_at = ? where token_hash = ?').run(nowIso(), hash);
  }
  if (stale(row.last_seen_at)) {
    db.prepare('update auth_users set last_seen_at = ? where id = ?').run(nowIso(), row.id);
  }
  return { id: row.id, email: row.email, sessionId: row.session_id };
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
  purgeChallenges();
  // The sending statistics look back at most 12 months (plus the comparison).
  db.prepare("delete from mail_log where sent_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-400 days')").run();
};

const isApproved = (userId: string) => {
  const row = db.prepare('select approved from app_users where id = ?').get(userId) as
    | { approved: number }
    | undefined;
  return !row || Boolean(row.approved);
};

// With "require 2FA" on, admins and accounts with access to all projects must
// have a verified factor; until then only 2FA setup (and signing out) works.
const isPrivileged = (userId: string) => {
  const row = db.prepare('select is_admin, can_manage_projects from app_users where id = ?').get(userId) as
    | { is_admin: number; can_manage_projects: number }
    | undefined;
  return Boolean(row && (row.is_admin || row.can_manage_projects));
};

export const mfaRequiredFor = (userId: string) => instanceSettings().requireAdmin2fa && isPrivileged(userId);

export const mfaSetupRequired = (userId: string) => mfaRequiredFor(userId) && !hasSecondFactor(userId);

// Adding or removing sign-in methods (and deleting the account) needs the
// session to have proved its user recently; otherwise the client asks for a
// second factor (or the password, without one) via /reauth and retries.
const REAUTH_WINDOW = 10 * 60 * 1000;

const requireRecentAuth = (user: SessionUser) => {
  const row = db.prepare('select reauth_at from auth_sessions where id = ?').get(user.sessionId ?? '') as
    | { reauth_at: string | null }
    | undefined;
  if (!row?.reauth_at || Date.now() - Date.parse(row.reauth_at) > REAUTH_WINDOW) {
    throw new ApiError('Please confirm it’s you', 403, 'reauth_required');
  }
};

// With 2FA required for this account, its last method can't be removed.
const assertCanRemoveMethod = (userId: string, method: string) => {
  const methods = mfaMethods(userId);
  if (mfaRequiredFor(userId) && methods.length === 1 && methods[0] === method) {
    throw new ApiError('Two-factor authentication is required for your account', 403, 'mfa_enforced');
  }
};

// Admins learn about sign-ups waiting for approval (when email works).
const notifyAdminsOfPendingSignup = async (name: string, email: string) => {
  if (!mailEnabled()) return;
  const admins = db
    .prepare(
      `select au.email from app_users u join auth_users au on au.id = u.id
       where u.is_admin and au.email_confirmed_at is not null`,
    )
    .all() as { email: string }[];
  for (const admin of admins) {
    try {
      await sendPendingSignupNotice(admin.email, name, email, env.publicUrl);
    } catch (err) {
      console.error('Sending approval notice failed:', err);
    }
  }
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

const sessionPayload = (user: SessionUser | null) => ({
  session: user ? { user: { id: user.id, email: user.email } } : null,
  // The app shows only the 2FA setup until this is false.
  mfa_setup_required: user ? mfaSetupRequired(user.id) : false,
});

export const authRoutes = new Hono();

authRoutes.get('/session', (c) => c.json(sessionPayload(sessionUser(c))));

authRoutes.post('/login', async (c) => {
  rateLimit(c, 'login', 20, 15 * 60 * 1000);
  const { email, password } = await body(c);
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
  if (!isApproved(user.id)) {
    throw new ApiError('Your account is waiting for approval by an administrator', 403, 'approval_pending');
  }

  // With two-factor on, the password only opens a challenge; /login/mfa
  // completes the sign-in with one of the account's methods.
  const methods = mfaMethods(user.id);
  if (methods.length > 0) {
    return c.json({
      session: null,
      mfa_required: true,
      mfa: { challenge_id: createChallenge(user.id, 'login'), methods },
    });
  }

  startSession(c, user.id, true);
  return c.json(sessionPayload({ id: user.id, email: user.email }));
});

// Second step of the sign-in: { challenge_id, method, code | credential }.
authRoutes.post('/login/mfa', async (c) => {
  rateLimit(c, 'mfa', 20, 15 * 60 * 1000);
  const input = await body(c);
  const challenge = getChallenge(input.challenge_id, ['login']);
  const userId = await verifyProof(challenge, input, baseUrl(c));
  return c.json(signInVerified(c, userId));
});

// Passwordless sign-in with a passkey: options first, then the assertion.
authRoutes.post('/passkey/options', async (c) => {
  rateLimit(c, 'login', 20, 15 * 60 * 1000);
  return c.json(await passkeyAuthenticationOptions(null, baseUrl(c)));
});

authRoutes.post('/passkey/login', async (c) => {
  rateLimit(c, 'login', 20, 15 * 60 * 1000);
  const input = await body(c);
  const challenge = getChallenge(input.challenge_id, ['passkey_login']);
  const userId = await verifyPasskeyLogin(challenge, input.credential, baseUrl(c));
  const account = db.prepare('select email_confirmed_at from auth_users where id = ?').get(userId) as
    | { email_confirmed_at: string | null }
    | undefined;
  if (!account?.email_confirmed_at) throw new ApiError('Email not confirmed', 400, 'email_not_confirmed');
  return c.json(signInVerified(c, userId));
});

const signInVerified = (c: Context, userId: string) => {
  if (!isApproved(userId)) {
    throw new ApiError('Your account is waiting for approval by an administrator', 403, 'approval_pending');
  }
  startSession(c, userId, true);
  const { email } = db.prepare('select email from auth_users where id = ?').get(userId) as { email: string };
  return sessionPayload({ id: userId, email });
};

// Email codes and passkey options for a pending challenge (sign-in or
// re-confirmation). The random challenge id is what authorizes the call.
authRoutes.post('/mfa/challenge/email', async (c) => {
  rateLimit(c, 'mfa-email', 10, 15 * 60 * 1000);
  const input = await body(c);
  const challenge = getChallenge(input.challenge_id, ['login', 'reauth']);
  if (!challenge.user_id || !mfaMethods(challenge.user_id).includes('email')) {
    throw new ApiError('This verification method is not available', 400, 'mfa_method_unavailable');
  }
  const { email } = db.prepare('select email from auth_users where id = ?').get(challenge.user_id) as {
    email: string;
  };
  await sendChallengeEmail(challenge, email);
  return c.json({ ok: true });
});

authRoutes.post('/mfa/challenge/passkey', async (c) => {
  rateLimit(c, 'mfa', 20, 15 * 60 * 1000);
  const input = await body(c);
  const challenge = getChallenge(input.challenge_id, ['login', 'reauth']);
  if (!challenge.user_id || !mfaMethods(challenge.user_id).includes('passkey')) {
    throw new ApiError('This verification method is not available', 400, 'mfa_method_unavailable');
  }
  const { options } = await passkeyAuthenticationOptions(challenge, baseUrl(c));
  return c.json({ options });
});

// Re-confirmation before sensitive changes (see requireRecentAuth): a second
// factor, or the password for accounts without one.
authRoutes.post('/reauth/start', (c) => {
  const user = requireSession(c);
  const methods = mfaMethods(user.id);
  return c.json({
    challenge_id: createChallenge(user.id, 'reauth'),
    methods: methods.length > 0 ? methods : ['password'],
  });
});

authRoutes.post('/reauth', async (c) => {
  rateLimit(c, 'mfa', 20, 15 * 60 * 1000);
  const user = requireSession(c);
  const input = await body(c);
  const challenge = getChallenge(input.challenge_id, ['reauth']);
  if (challenge.user_id !== user.id) throw new ApiError('Invalid confirmation', 400, 'mfa_challenge_expired');
  if (input.method === 'password' && !hasSecondFactor(user.id)) {
    await checkOwnPassword(user.id, input.password);
    endReauthChallenge(challenge);
  } else {
    await verifyProof(challenge, input, baseUrl(c));
  }
  db.prepare('update auth_sessions set reauth_at = ? where id = ?').run(nowIso(), user.sessionId ?? '');
  return c.json({ ok: true });
});

const endReauthChallenge = (challenge: Challenge) =>
  db.prepare('delete from auth_challenges where id_hash = ?').run(challenge.id_hash);

const checkOwnPassword = async (userId: string, password: unknown) => {
  const row = db.prepare('select password_hash from auth_users where id = ?').get(userId) as
    | { password_hash: string }
    | undefined;
  if (!row || typeof password !== 'string' || !(await verifyPassword(password, row.password_hash))) {
    throw new ApiError('Invalid password', 400, 'invalid_credentials');
  }
};

authRoutes.post('/logout', (c) => {
  const token = getCookie(c, COOKIE);
  if (token) db.prepare('delete from auth_sessions where token_hash = ?').run(sha256(token));
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

authRoutes.post('/signup', async (c) => {
  rateLimit(c, 'signup', 10, 60 * 60 * 1000);
  const settings = instanceSettings();
  if (!settings.allowSelfSignup) {
    throw new ApiError('Signups not allowed for this instance', 403, 'signup_disabled');
  }

  const input = await body(c);
  const email = normalizeEmail(input.email);
  if (!emailDomainAllowed(email, settings.allowedDomains)) {
    throw new ApiError('Sign-up is not open for this email domain', 403, 'signup_domain_not_allowed');
  }
  const approved = !settings.requiresApproval;
  const password = validatePassword(input.password);
  const name = typeof input.name === 'string' ? input.name : '';

  const existing = db
    .prepare('select id, email_confirmed_at from auth_users where email = ? collate nocase')
    .get(email) as { id: string; email_confirmed_at: string | null } | undefined;

  if (!mailEnabled()) {
    // No mail server: accounts are confirmed right away.
    if (existing) throw new ApiError('User already registered', 422, 'user_already_exists');
    const id = await createAccount({ email, password, name, confirmed: true, approved });
    if (!approved) {
      void notifyAdminsOfPendingSignup(name, email);
      return c.json({ ...sessionPayload(null), approval_pending: true });
    }
    startSession(c, id, true);
    return c.json(sessionPayload({ id, email }));
  }

  // With confirmation on, never reveal whether an address is registered.
  if (existing) {
    if (!existing.email_confirmed_at) await sendConfirmSignup(email, issueLink(c, existing.id, 'confirm_signup', email));
    return c.json({ ...sessionPayload(null), approval_pending: !approved });
  }
  const id = await createAccount({ email, password, name, confirmed: false, approved });
  try {
    await sendConfirmSignup(email, issueLink(c, id, 'confirm_signup', email));
  } catch (err) {
    console.error('Sending confirmation email failed:', err);
    db.prepare('delete from auth_users where id = ?').run(id);
    throw new ApiError('Error sending confirmation email', 500, 'email_send_failed');
  }
  return c.json({ ...sessionPayload(null), approval_pending: !approved });
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
  // Confirmed, but an admin still has to approve the account.
  if (!isApproved(row.user_id)) {
    if (row.kind === 'confirm_signup') {
      const account = db.prepare('select name from app_users where id = ?').get(row.user_id) as
        | { name: string }
        | undefined;
      void notifyAdminsOfPendingSignup(account?.name ?? '', row.email);
    }
    return c.redirect('/login?pending=1');
  }
  // A second factor still has to be entered on the login page.
  if (!hasSecondFactor(row.user_id)) startSession(c, row.user_id, false);
  return c.redirect(target);
});

// Change the own email and/or password.
authRoutes.patch('/user', async (c) => {
  const user = requireSession(c);
  const input = await body(c);
  let emailChangePending = false;
  // A hijacked session alone must not be able to take over the account.
  if (input.password !== undefined || (input.email !== undefined && input.email !== user.email)) {
    requireRecentAuth(user);
  }

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
      if (mailEnabled()) {
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
// recent confirmation with a second factor). Deleting the auth user cascades
// to the profile, sessions, tokens, 2FA and project scope; linked member rows
// keep their attendance history and are just unlinked.
authRoutes.delete('/user', async (c) => {
  rateLimit(c, 'delete-account', 10, 15 * 60 * 1000);
  const user = requireSession(c);
  const { password } = await body(c);

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

  await checkOwnPassword(user.id, password);
  if (hasSecondFactor(user.id)) requireRecentAuth(user);

  db.prepare('delete from auth_users where id = ?').run(user.id);
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

// --- two-factor -------------------------------------------------------------
// Adding or removing a method needs a recent sign-in or re-confirmation, so a
// hijacked session alone can neither remove 2FA nor plant its own factor.

authRoutes.get('/mfa/factors', (c) => {
  const user = requireSession(c);
  return c.json({ ...factorSummary(user.id), required: mfaRequiredFor(user.id) });
});

// Authenticator app: enroll returns the secret (QR code and manual entry);
// verify activates it with a first code from the app.
authRoutes.post('/mfa/enroll', (c) => {
  const user = requireSession(c);
  if (verifiedTotp(user.id)) throw new ApiError('An authenticator app is already set up', 422);
  requireRecentAuth(user);
  const secret = base32Encode(randomBytes(20));
  const id = uuid();
  db.transaction(() => {
    db.prepare(`delete from auth_factors where user_id = ? and status = 'unverified'`).run(user.id);
    db.prepare('insert into auth_factors (id, user_id, secret) values (?, ?, ?)').run(id, user.id, secret);
  })();
  const issuer = branding().appName;
  const label = encodeURIComponent(`${issuer}:${user.email}`);
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  return c.json({ id, factor_type: 'totp', totp: { secret, uri } });
});

authRoutes.post('/mfa/verify', async (c) => {
  rateLimit(c, 'mfa', 20, 15 * 60 * 1000);
  const user = requireSession(c);
  const { factorId, code } = await body(c);
  const factor = db
    .prepare(`select id, secret, last_step from auth_factors where id = ? and user_id = ? and status = 'unverified'`)
    .get(String(factorId ?? ''), user.id) as { id: string; secret: string; last_step: number | null } | undefined;
  if (!factor) throw new ApiError('Factor not found', 404, 'mfa_factor_not_found');
  useTotpCode(factor, String(code ?? ''));
  db.prepare(`update auth_factors set status = 'verified' where id = ?`).run(factor.id);
  return c.json({ ok: true });
});

// An unfinished enrollment can be discarded freely.
authRoutes.post('/mfa/unenroll', async (c) => {
  const user = requireSession(c);
  const { factorId } = await body(c);
  const factor = db
    .prepare('select id, status from auth_factors where id = ? and user_id = ?')
    .get(String(factorId ?? ''), user.id) as { id: string; status: string } | undefined;
  if (!factor) throw new ApiError('Factor not found', 404, 'mfa_factor_not_found');
  if (factor.status === 'verified') {
    assertCanRemoveMethod(user.id, 'totp');
    requireRecentAuth(user);
  }
  db.prepare('delete from auth_factors where id = ?').run(factor.id);
  return c.json({ ok: true });
});

// Passkeys: registration options, then the device's response (+ a name).
authRoutes.post('/mfa/passkeys/options', async (c) => {
  const user = requireSession(c);
  requireRecentAuth(user);
  const profile = db.prepare('select name from app_users where id = ?').get(user.id) as { name: string } | undefined;
  return c.json(await passkeyRegistrationOptions({ ...user, name: profile?.name ?? '' }, baseUrl(c)));
});

authRoutes.post('/mfa/passkeys', async (c) => {
  rateLimit(c, 'mfa', 20, 15 * 60 * 1000);
  const user = requireSession(c);
  const input = await body(c);
  const challenge = getChallenge(input.challenge_id, ['passkey_register']);
  if (challenge.user_id !== user.id) throw new ApiError('Invalid confirmation', 400, 'mfa_challenge_expired');
  await registerPasskey(challenge, input.credential, input.name, baseUrl(c));
  return c.json({ ok: true });
});

authRoutes.post('/mfa/passkeys/remove', async (c) => {
  const user = requireSession(c);
  const { id } = await body(c);
  const passkey = db.prepare('select id from auth_passkeys where id = ? and user_id = ?').get(String(id ?? ''), user.id);
  if (!passkey) throw new ApiError('Passkey not found', 404, 'mfa_factor_not_found');
  const count = (db.prepare('select count(*) as n from auth_passkeys where user_id = ?').get(user.id) as { n: number }).n;
  if (count === 1) assertCanRemoveMethod(user.id, 'passkey');
  requireRecentAuth(user);
  db.prepare('delete from auth_passkeys where id = ?').run(String(id));
  return c.json({ ok: true });
});

// Email codes: enroll sends a code to the account's address, verify turns
// them on with it. Only while the admin allows them and email works.
authRoutes.post('/mfa/email/enroll', async (c) => {
  rateLimit(c, 'mfa-email', 10, 15 * 60 * 1000);
  const user = requireSession(c);
  if (!email2faAvailable()) {
    throw new ApiError('Codes by email are not available', 400, 'mfa_method_unavailable');
  }
  requireRecentAuth(user);
  const token = createChallenge(user.id, 'email_enroll');
  await sendChallengeEmail(getChallenge(token, ['email_enroll']), user.email);
  return c.json({ challenge_id: token });
});

authRoutes.post('/mfa/email/verify', async (c) => {
  rateLimit(c, 'mfa', 20, 15 * 60 * 1000);
  const user = requireSession(c);
  const input = await body(c);
  const challenge = getChallenge(input.challenge_id, ['email_enroll']);
  if (challenge.user_id !== user.id) throw new ApiError('Invalid confirmation', 400, 'mfa_challenge_expired');
  await verifyProof(challenge, { ...input, method: 'email' }, baseUrl(c));
  setEmail2fa(user.id, true);
  return c.json({ ok: true });
});

authRoutes.post('/mfa/email/disable', (c) => {
  const user = requireSession(c);
  if (mfaMethods(user.id).includes('email')) assertCanRemoveMethod(user.id, 'email');
  requireRecentAuth(user);
  setEmail2fa(user.id, false);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Sessions per device
// ---------------------------------------------------------------------------

authRoutes.get('/sessions', (c) => {
  const user = requireSession(c);
  const rows = db
    .prepare(
      `select id, user_agent, created_at, last_seen_at from auth_sessions
       where user_id = ? and expires_at > ? order by coalesce(last_seen_at, created_at) desc`,
    )
    .all(user.id, nowIso()) as { id: string; user_agent: string | null; created_at: string; last_seen_at: string | null }[];
  return c.json({ sessions: rows.map((r) => ({ ...r, current: r.id === user.sessionId })) });
});

// Signs out one other device, or every other device with { others: true }.
authRoutes.post('/sessions/revoke', async (c) => {
  const user = requireSession(c);
  const { id, others } = await body(c);
  if (others === true) {
    db.prepare('delete from auth_sessions where user_id = ? and id is not ?').run(user.id, user.sessionId ?? null);
  } else {
    if (typeof id !== 'string' || id === user.sessionId) throw new ApiError('Invalid session', 400);
    db.prepare('delete from auth_sessions where user_id = ? and id = ?').run(user.id, id);
  }
  return c.json({ ok: true });
});

// Runs an authenticated handler body as the session's user (see db.asUser).
export const withSessionUser = <T>(c: Context, fn: (user: SessionUser | null) => T): T => {
  const user = sessionUser(c);
  return asUser(user?.id ?? null, () => fn(user));
};
