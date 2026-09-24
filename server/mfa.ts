// Second factors: authenticator app (TOTP), passkeys (WebAuthn) and codes by
// email (when the admin allows them and email works). Any one of them
// satisfies two-factor authentication. Sign-in and re-confirmation ask for one
// through a short-lived challenge; the routes live in auth.ts.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { db, nowIso, ApiError } from './db.ts';
import { branding } from './branding.ts';
import { mailEnabled, sendTwoFactorCode } from './mail.ts';
import { instanceSettings } from './settings.ts';

export type MfaMethod = 'totp' | 'passkey' | 'email';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const invalidCode = () => new ApiError('Invalid verification code', 422, 'mfa_verification_failed');

// ---------------------------------------------------------------------------
// TOTP (RFC 6238, SHA-1, 6 digits, 30 s)
// ---------------------------------------------------------------------------

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const base32Encode = (buffer: Buffer) => {
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
    if (safeEqual(hotp(key, step), clean)) return step;
  }
  return null;
};

type TotpFactor = { id: string; secret: string; last_step: number | null };

export const verifiedTotp = (userId: string) =>
  db
    .prepare(`select id, secret, last_step from auth_factors where user_id = ? and status = 'verified'`)
    .get(userId) as TotpFactor | undefined;

// Checks a code and burns its time step so it can't be replayed.
export const useTotpCode = (factor: TotpFactor, code: string) => {
  const step = verifyTotp(factor.secret, code, factor.last_step);
  if (step === null) throw invalidCode();
  db.prepare('update auth_factors set last_step = ? where id = ?').run(step, factor.id);
};

// ---------------------------------------------------------------------------
// Methods per account
// ---------------------------------------------------------------------------

// Email codes need the admin's permission and a working mail setup; while
// either is missing they don't count (and aren't asked for).
export const email2faAvailable = () => instanceSettings().allowEmail2fa && mailEnabled();

const emailFlag = (userId: string) =>
  Boolean(
    (db.prepare('select email_2fa from auth_users where id = ?').get(userId) as { email_2fa: number } | undefined)
      ?.email_2fa,
  );

export const mfaMethods = (userId: string): MfaMethod[] => {
  const methods: MfaMethod[] = [];
  if (verifiedTotp(userId)) methods.push('totp');
  if (db.prepare('select 1 from auth_passkeys where user_id = ?').get(userId)) methods.push('passkey');
  if (emailFlag(userId) && email2faAvailable()) methods.push('email');
  return methods;
};

export const hasSecondFactor = (userId: string) => mfaMethods(userId).length > 0;

// Accounts with at least one active second factor (admin user list).
export const usersWithSecondFactor = () => {
  const email = email2faAvailable();
  return (
    db
      .prepare(
        `select user_id from auth_factors where status = 'verified'
         union select user_id from auth_passkeys
         union select id from auth_users where email_2fa and ?`,
      )
      .all(email ? 1 : 0) as { user_id: string }[]
  ).map((r) => r.user_id);
};

export const factorSummary = (userId: string) => ({
  totp: db
    .prepare('select id, status, created_at from auth_factors where user_id = ? order by created_at')
    .all(userId) as { id: string; status: string; created_at: string }[],
  passkeys: db
    .prepare('select id, name, created_at, last_used_at from auth_passkeys where user_id = ? order by created_at')
    .all(userId),
  email: { enabled: emailFlag(userId), available: email2faAvailable() },
  methods: mfaMethods(userId),
});

export const setEmail2fa = (userId: string, enabled: boolean) =>
  db.prepare('update auth_users set email_2fa = ? where id = ?').run(enabled ? 1 : 0, userId);

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

export type ChallengePurpose = 'login' | 'reauth' | 'email_enroll' | 'passkey_register' | 'passkey_login';

export interface Challenge {
  id_hash: string;
  user_id: string | null;
  purpose: ChallengePurpose;
  webauthn_challenge: string | null;
  email_code_hash: string | null;
  email_sent_at: string | null;
  attempts: number;
  expires_at: string;
}

const CHALLENGE_TTL = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const EMAIL_RESEND_MS = 30 * 1000;

const expired = () =>
  new ApiError('The confirmation has expired, please start again', 400, 'mfa_challenge_expired');

// Returns the token the client refers to the challenge by.
export const createChallenge = (userId: string | null, purpose: ChallengePurpose) => {
  const token = randomBytes(32).toString('base64url');
  db.transaction(() => {
    // One open challenge per account and purpose.
    if (userId) db.prepare('delete from auth_challenges where user_id = ? and purpose = ?').run(userId, purpose);
    db.prepare('insert into auth_challenges (id_hash, user_id, purpose, expires_at) values (?, ?, ?, ?)').run(
      sha256(token),
      userId,
      purpose,
      new Date(Date.now() + CHALLENGE_TTL).toISOString(),
    );
  })();
  return token;
};

export const getChallenge = (token: unknown, purposes: ChallengePurpose[]) => {
  if (typeof token !== 'string' || !token) throw expired();
  const row = db.prepare('select * from auth_challenges where id_hash = ?').get(sha256(token)) as
    | Challenge
    | undefined;
  if (!row || !purposes.includes(row.purpose)) throw expired();
  if (Date.parse(row.expires_at) <= Date.now()) {
    endChallenge(row);
    throw expired();
  }
  return row;
};

// Single use: a challenge only completes once, even with concurrent requests.
const endChallenge = (row: Challenge) => {
  const { changes } = db.prepare('delete from auth_challenges where id_hash = ?').run(row.id_hash);
  if (changes !== 1) throw expired();
};

const failAttempt = (row: Challenge) => {
  if (row.attempts + 1 >= MAX_ATTEMPTS) {
    db.prepare('delete from auth_challenges where id_hash = ?').run(row.id_hash);
  } else {
    db.prepare('update auth_challenges set attempts = attempts + 1 where id_hash = ?').run(row.id_hash);
  }
};

export const purgeChallenges = () => db.prepare('delete from auth_challenges where expires_at <= ?').run(nowIso());

// Emails a fresh 6-digit code for the challenge to `to`.
export const sendChallengeEmail = async (row: Challenge, to: string) => {
  if (row.email_sent_at && Date.now() - Date.parse(row.email_sent_at) < EMAIL_RESEND_MS) {
    throw new ApiError('Please wait a moment before requesting another code', 429, 'mfa_email_throttled');
  }
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  db.prepare(
    'update auth_challenges set email_code_hash = ?, email_sent_at = ?, expires_at = ? where id_hash = ?',
  ).run(sha256(code), nowIso(), new Date(Date.now() + CHALLENGE_TTL).toISOString(), row.id_hash);
  try {
    await sendTwoFactorCode(to, code);
  } catch (err) {
    console.error('Sending verification code failed:', err);
    throw new ApiError('Error sending the email', 500, 'email_send_failed');
  }
};

// ---------------------------------------------------------------------------
// Passkeys (WebAuthn)
// ---------------------------------------------------------------------------

// The relying party is this app's origin (PUBLIC_URL or the request host).
const rpId = (origin: string) => new URL(origin).hostname;

interface PasskeyRow {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
}

const transportsOf = (row: { transports: string | null }) => {
  try {
    const value = JSON.parse(row.transports ?? '[]');
    return Array.isArray(value) ? (value as string[]) : undefined;
  } catch {
    return undefined;
  }
};

const passkeysOf = (userId: string) =>
  db.prepare('select id, user_id, public_key, counter, transports from auth_passkeys where user_id = ?').all(userId) as
    PasskeyRow[];

export const passkeyRegistrationOptions = async (
  user: { id: string; email: string; name: string },
  origin: string,
) => {
  const token = createChallenge(user.id, 'passkey_register');
  const options = await generateRegistrationOptions({
    rpName: branding().appName,
    rpID: rpId(origin),
    userName: user.email,
    userDisplayName: user.name || user.email,
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    excludeCredentials: passkeysOf(user.id).map((p) => ({ id: p.id, transports: transportsOf(p) })),
    // Discoverable where possible, so the passkey can sign in without a password.
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });
  db.prepare('update auth_challenges set webauthn_challenge = ? where id_hash = ?').run(
    options.challenge,
    sha256(token),
  );
  return { challenge_id: token, options };
};

export const registerPasskey = async (
  row: Challenge,
  response: unknown,
  name: unknown,
  origin: string,
) => {
  if (!row.user_id || !row.webauthn_challenge) throw expired();
  let result;
  try {
    result = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: row.webauthn_challenge,
      expectedOrigin: origin,
      expectedRPID: rpId(origin),
      requireUserVerification: false,
    });
  } catch (err) {
    console.warn('Passkey registration rejected:', err instanceof Error ? err.message : err);
    throw new ApiError('The passkey could not be verified', 422, 'passkey_invalid');
  }
  endChallenge(row);
  if (!result.verified) throw new ApiError('The passkey could not be verified', 422, 'passkey_invalid');
  const { credential } = result.registrationInfo;
  const label = typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : 'Passkey';
  try {
    db.prepare(
      'insert into auth_passkeys (id, user_id, public_key, counter, transports, name) values (?, ?, ?, ?, ?, ?)',
    ).run(
      credential.id,
      row.user_id,
      Buffer.from(credential.publicKey).toString('base64url'),
      credential.counter,
      JSON.stringify(credential.transports ?? []),
      label,
    );
  } catch {
    throw new ApiError('This passkey is already registered', 422, 'passkey_exists');
  }
};

// Options for a passkey as second factor (only this account's passkeys), or
// for a passwordless sign-in (any passkey the device holds for this site).
export const passkeyAuthenticationOptions = async (row: Challenge | null, origin: string) => {
  let token: string | null = null;
  if (!row) {
    token = createChallenge(null, 'passkey_login');
    row = getChallenge(token, ['passkey_login']);
  }
  const options = await generateAuthenticationOptions({
    rpID: rpId(origin),
    allowCredentials: row.user_id
      ? passkeysOf(row.user_id).map((p) => ({ id: p.id, transports: transportsOf(p) }))
      : undefined,
    // Passwordless sign-in must verify the user on the device itself.
    userVerification: row.purpose === 'passkey_login' ? 'required' : 'preferred',
  });
  db.prepare('update auth_challenges set webauthn_challenge = ? where id_hash = ?').run(
    options.challenge,
    row.id_hash,
  );
  return { challenge_id: token, options };
};

// Verifies a passkey assertion for the challenge; returns the account it
// belongs to. Does not end the challenge.
const verifyPasskey = async (row: Challenge, response: unknown, origin: string) => {
  const assertion = response as AuthenticationResponseJSON;
  if (!row.webauthn_challenge || typeof assertion?.id !== 'string') throw invalidCode();
  const passkey = db
    .prepare('select id, user_id, public_key, counter, transports from auth_passkeys where id = ?')
    .get(assertion.id) as PasskeyRow | undefined;
  if (!passkey || (row.user_id && passkey.user_id !== row.user_id)) {
    throw new ApiError('This passkey is not registered for this account', 422, 'passkey_unknown');
  }
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: row.webauthn_challenge,
      expectedOrigin: origin,
      expectedRPID: rpId(origin),
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(Buffer.from(passkey.public_key, 'base64url')),
        counter: passkey.counter,
        transports: transportsOf(passkey),
      },
      requireUserVerification: row.purpose === 'passkey_login',
    });
  } catch (err) {
    console.warn('Passkey assertion rejected:', err instanceof Error ? err.message : err);
    throw invalidCode();
  }
  if (!result.verified) throw invalidCode();
  db.prepare('update auth_passkeys set counter = ?, last_used_at = ? where id = ?').run(
    result.authenticationInfo.newCounter,
    nowIso(),
    passkey.id,
  );
  return passkey.user_id;
};

// Passwordless sign-in: returns the passkey's account.
export const verifyPasskeyLogin = async (row: Challenge, response: unknown, origin: string) => {
  try {
    const userId = await verifyPasskey(row, response, origin);
    endChallenge(row);
    return userId;
  } catch (err) {
    failAttempt(row);
    throw err;
  }
};

// ---------------------------------------------------------------------------
// Proofs
// ---------------------------------------------------------------------------

// Checks a second factor for a login / reauth / email_enroll challenge:
// { method: 'totp' | 'email', code } or { method: 'passkey', credential }.
// Ends the challenge on success; failures count towards its attempt limit.
export const verifyProof = async (row: Challenge, input: Record<string, unknown>, origin: string) => {
  const userId = row.user_id;
  if (!userId) throw expired();
  const { method, code } = input;
  // Enrolling email codes proves the address, not an existing factor.
  const allowed: string[] = row.purpose === 'email_enroll' ? ['email'] : mfaMethods(userId);
  if (typeof method !== 'string' || !allowed.includes(method)) {
    throw new ApiError('This verification method is not available', 400, 'mfa_method_unavailable');
  }
  try {
    if (method === 'totp') {
      const factor = verifiedTotp(userId);
      if (!factor || typeof code !== 'string') throw invalidCode();
      useTotpCode(factor, code);
    } else if (method === 'email') {
      const clean = typeof code === 'string' ? code.replace(/\s/g, '') : '';
      if (!row.email_code_hash || !/^\d{6}$/.test(clean) || !safeEqual(sha256(clean), row.email_code_hash)) {
        throw invalidCode();
      }
    } else {
      await verifyPasskey(row, input.credential, origin);
    }
  } catch (err) {
    failAttempt(row);
    throw err;
  }
  endChallenge(row);
  return userId;
};
