-- Outgoing email (SMTP) configured in Admin Config. Deliberately a table of its
-- own without a data-API policy: it is only reachable through the admin-only
-- server functions, never through /api/rest (app_settings is world-readable).
-- No row = fall back to the SMTP_* environment variables.
create table smtp_settings (
  id           integer primary key default 1 check (id = 1),
  host         text not null,
  port         integer not null check (port between 1 and 65535),
  -- tls = implicit TLS (usually 465), starttls = required STARTTLS (usually
  -- 587), none = unencrypted (only allowed without a password, or to localhost).
  security     text not null check (security in ('tls', 'starttls', 'none')),
  username     text,
  -- AES-256-GCM encrypted (see server/secrets.ts); never sent to the browser.
  password_enc text,
  from_address text not null,
  from_name    text,
  updated_at   text not null default (now_iso()),
  updated_by   text references auth_users (id) on delete set null
);
