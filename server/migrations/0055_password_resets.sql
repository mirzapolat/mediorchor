-- Password reset links ("Passwort vergessen?" on the login page, or sent by an
-- admin). One per account; only a hash of the token is stored. Kept apart from
-- auth_tokens, whose check constraint would need a table rebuild. No data-API
-- policy: only the server reads it.
create table auth_password_resets (
  user_id    text primary key references auth_users (id) on delete cascade,
  token_hash text not null unique,
  created_at text not null default (now_iso()),
  expires_at text not null
);
