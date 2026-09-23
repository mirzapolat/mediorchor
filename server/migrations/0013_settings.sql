-- Settings round: sessions per device, sign-up restrictions and approval,
-- required 2FA for privileged accounts, email notifications, project sign-up
-- rules.

-- ---------------------------------------------------------------------------
-- Instance settings (Admin Config)
-- ---------------------------------------------------------------------------

-- Days a session lasts (and slides); null = SESSION_DAYS from the environment.
alter table app_settings add column session_days integer;
-- Self sign-up only for these email domains (comma/space/newline separated;
-- empty = any domain).
alter table app_settings add column signup_allowed_domains text not null default '';
-- New self sign-ups must be approved by an admin before they can sign in.
alter table app_settings add column signup_requires_approval boolean not null default 0;
-- Admins and accounts with access to all projects must use 2FA.
alter table app_settings add column require_admin_2fa boolean not null default 0;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

-- 0 = waiting for admin approval (self sign-up with approval required).
alter table app_users add column approved boolean not null default 1;
-- Email notifications, opt-in.
alter table app_users add column notify_reminders boolean not null default 0;
alter table app_users add column notify_status boolean not null default 0;
alter table app_users add column notify_weekly boolean not null default 0;
-- Language for emails (the UI language is per device); null = instance default.
alter table app_users add column language text check (language in ('de', 'en'));

-- ---------------------------------------------------------------------------
-- Sessions: listable and revocable per device
-- ---------------------------------------------------------------------------

alter table auth_sessions add column id text;
alter table auth_sessions add column user_agent text;
alter table auth_sessions add column last_seen_at text;
update auth_sessions set id = lower(hex(randomblob(16))), last_seen_at = created_at;
create unique index auth_sessions_id_idx on auth_sessions (id);

-- ---------------------------------------------------------------------------
-- Projects: sign-up rules
-- ---------------------------------------------------------------------------

-- Sign-up forms and guest check-ins must name a group (when the project has any).
alter table projects add column require_signup_group boolean not null default 0;
-- Group for new members added without one (any path: forms, import, manual).
alter table projects add column default_group text;

create trigger members_default_group
after insert on members
for each row
when new.group_name is null
begin
  update members set group_name = (
    select pg.name from projects p
    join project_groups pg on pg.project_id = p.id and pg.name = p.default_group
    where p.id = new.project_id
  )
  where id = new.id;
end;

-- The default group follows renames and disappears with its group.
create trigger project_groups_rename_default
after update of name on project_groups
for each row
when new.name collate binary is not old.name
begin
  update projects set default_group = new.name
  where id = new.project_id and ulower(default_group) = ulower(old.name);
end;

create trigger project_groups_delete_default
after delete on project_groups
for each row
begin
  update projects set default_group = null
  where id = old.project_id and ulower(default_group) = ulower(old.name);
end;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

-- What was sent, so nothing goes out twice (ref: event id, ISO week, ...).
create table notification_log (
  user_id text not null references app_users (id) on delete cascade,
  kind    text not null check (kind in ('reminder', 'weekly', 'status')),
  ref     text not null,
  sent_at text not null default (now_iso()),
  primary key (user_id, kind, ref)
);

-- Attendance set to excused/absent by someone other than the member; the
-- notifier mails the latest state per event after a short debounce.
create table notification_outbox (
  id         integer primary key autoincrement,
  user_id    text not null references app_users (id) on delete cascade,
  event_id   text not null references events (id) on delete cascade,
  status     text not null,
  created_at text not null default (now_iso())
);

create trigger attendance_status_notice_insert
after insert on attendance
for each row
when new.status in ('excused', 'not_attended')
begin
  insert into notification_outbox (user_id, event_id, status)
  select m.user_id, new.event_id, new.status from members m
  where m.id = new.member_id and m.user_id is not null
    and m.user_id is not coalesce(auth_uid(), '');
end;

create trigger attendance_status_notice_update
after update of status on attendance
for each row
when new.status is not old.status and new.status in ('excused', 'not_attended')
begin
  insert into notification_outbox (user_id, event_id, status)
  select m.user_id, new.event_id, new.status from members m
  where m.id = new.member_id and m.user_id is not null
    and m.user_id is not coalesce(auth_uid(), '');
end;
