-- More second factors next to the authenticator app (auth_factors): passkeys
-- (WebAuthn) and codes by email. Any one of them is enough to satisfy 2FA.

-- Passkeys. A passkey also signs in on its own (the device verifies the user),
-- so adding one needs a recent sign-in (auth_sessions.reauth_at).
create table auth_passkeys (
  id           text primary key,  -- credential id (base64url)
  user_id      text not null references auth_users (id) on delete cascade,
  public_key   text not null,     -- COSE public key (base64url)
  counter      integer not null default 0,
  transports   text,              -- JSON array of transport hints
  name         text not null default '',
  created_at   text not null default (now_iso()),
  last_used_at text
);
create index auth_passkeys_user_idx on auth_passkeys (user_id);

-- Codes sent by email as second factor. Only counts while the admin allows it
-- and email works (see server/mfa.ts).
alter table auth_users add column email_2fa boolean not null default 0;
alter table app_settings add column allow_email_2fa boolean not null default 0;

-- When the session last proved its user (password, second factor or passkey).
-- Adding or removing sign-in methods requires this to be recent.
alter table auth_sessions add column reauth_at text;

-- Pending second-factor checks, identified by a random token (stored hashed):
-- the step after the password at sign-in, a re-confirmation, enrolling email
-- codes, adding a passkey, a passkey sign-in. attempts caps code guessing.
create table auth_challenges (
  id_hash            text primary key,
  user_id            text references auth_users (id) on delete cascade,
  purpose            text not null
                     check (purpose in ('login', 'reauth', 'email_enroll', 'passkey_register', 'passkey_login')),
  webauthn_challenge text,
  email_code_hash    text,
  email_sent_at      text,
  attempts           integer not null default 0,
  expires_at         text not null
);
create index auth_challenges_user_idx on auth_challenges (user_id);
