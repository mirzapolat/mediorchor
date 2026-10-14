-- Confirmation emails: to people who registered for a project, checked in to
-- a Probe, or signed up for an account. Admins switch each kind on for the
-- whole instance (off by default, so existing instances don't start sending);
-- each project can then turn its two kinds off again.
alter table app_settings add column mail_registration_received boolean not null default 0;
alter table app_settings add column mail_checkin_confirmation boolean not null default 0;
alter table app_settings add column mail_signup_welcome boolean not null default 0;

alter table projects add column notify_registration_received boolean not null default 1;
alter table projects add column notify_checkin_confirmation boolean not null default 1;

-- What went out, so nothing is sent twice and the public forms can't be used
-- to flood someone's inbox. Only a hash of the address is kept. No data-API
-- policy: only the server reads it. Purged together with mail_log.
create table confirmation_log (
  id             integer primary key autoincrement,
  kind           text not null check (kind in ('registration', 'checkin', 'welcome')),
  -- What the email was about (event + member, account), for one-time kinds.
  ref            text,
  recipient_hash text not null,
  sent_at        text not null default (now_iso())
);
create index confirmation_log_recipient_idx on confirmation_log (kind, recipient_hash, sent_at);
create index confirmation_log_ref_idx on confirmation_log (kind, ref);

-- mail_log gets the new kind; SQLite can't alter a check constraint, so the
-- table is rebuilt with its rows.
create table mail_log_new (
  id      integer primary key autoincrement,
  sent_at text not null default (now_iso()),
  kind    text not null check (kind in ('account', 'reminder', 'status', 'weekly', 'test', 'confirmation')),
  ok      boolean not null,
  error   text
);
insert into mail_log_new (id, sent_at, kind, ok, error) select id, sent_at, kind, ok, error from mail_log;
drop table mail_log;
alter table mail_log_new rename to mail_log;
create index mail_log_sent_idx on mail_log (sent_at);
