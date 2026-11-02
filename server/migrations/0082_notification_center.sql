-- Notification center: every notification lands in the account's inbox
-- (notifications); per category the account chooses how it reaches them —
-- not at all, in the app only, in the app and as push (installed app), or in
-- the app and by email (notification_prefs). The categories are listed in
-- shared/notifications.ts. None of these tables has a data-API policy: only
-- the server's functions (server/notificationCenter.ts) read and write them.

create table notifications (
  id            text primary key default (uuid()),
  user_id       text not null references app_users (id) on delete cascade,
  category      text not null,
  project_id    text references projects (id) on delete cascade,
  -- Unread notifications with the same key are merged ("3 new sign-ups").
  group_key     text,
  title         text not null,
  body          text not null default '',
  -- Where a click leads (an in-app path).
  link          text,
  count         integer not null default 1,
  -- What merged notifications are built from (names, counts).
  data          json not null default '{}',
  created_at    text not null default (now_iso()),
  read_at       text,
  -- "Done": out of the open list, still findable under "Done".
  archived_at   text,
  push_pending  boolean not null default 0,
  email_pending boolean not null default 0
);
create index notifications_user_idx on notifications (user_id, archived_at, created_at);
create index notifications_group_idx on notifications (user_id, group_key) where read_at is null and archived_at is null;
create index notifications_pending_idx on notifications (created_at) where push_pending or email_pending;

create table notification_prefs (
  user_id  text not null references app_users (id) on delete cascade,
  category text not null,
  channel  text not null check (channel in ('off', 'inapp', 'push', 'email')),
  primary key (user_id, category)
) without rowid;

-- Devices that receive push messages (the installed app).
create table push_subscriptions (
  id           text primary key default (uuid()),
  user_id      text not null references app_users (id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   text not null default (now_iso()),
  last_used_at text
);
create index push_subscriptions_user_idx on push_subscriptions (user_id);

-- What happened (written by triggers and the server), turned into
-- notifications by the dispatcher after a short delay: it finds the
-- recipients, merges repeated changes and renders the texts per language.
create table notification_queue (
  id         integer primary key autoincrement,
  kind       text not null,
  ref        text not null,
  project_id text,
  actor_id   text,
  data       json not null default '{}',
  created_at text not null default (now_iso())
);
create index notification_queue_kind_idx on notification_queue (kind, ref);

-- One-time notifications already made (a survey opened, a concert
-- published, a reminder): user_id '' for "everyone was told".
create table notification_marks (
  kind       text not null,
  ref        text not null,
  user_id    text not null default '',
  created_at text not null default (now_iso()),
  primary key (kind, ref, user_id)
) without rowid;

-- The former email switches become the channel "email" of their category.
insert into notification_prefs (user_id, category, channel)
  select id, 'event_reminder', 'email' from app_users where notify_reminders;
insert into notification_prefs (user_id, category, channel)
  select id, 'attendance_changed', 'email' from app_users where notify_status;
insert into notification_prefs (user_id, category, channel)
  select id, 'weekly_overview', 'email' from app_users where notify_weekly;

-- What was sent before stays sent.
insert or ignore into notification_marks (kind, ref, user_id, created_at)
  select case kind when 'reminder' then 'event_reminder' else 'weekly_overview' end, ref, user_id, sent_at
  from notification_log where kind in ('reminder', 'weekly');

-- What is already out there is no news: no notification for surveys,
-- concerts, weekends and room choices that exist today.
insert or ignore into notification_marks (kind, ref) select 'survey_new', id from forms where status = 'published';
insert or ignore into notification_marks (kind, ref) select 'concert_published', id from concerts where status = 'published';
insert or ignore into notification_marks (kind, ref) select 'weekend_published', id from weekends where details_published;
insert or ignore into notification_marks (kind, ref) select 'weekend_rooms', id from weekends where rooms_status <> 'hidden';

-- The old attendance notice queue is replaced by notification_queue.
drop trigger if exists attendance_status_notice_insert;
drop trigger if exists attendance_status_notice_update;
drop table notification_outbox;

-- mail_log gets the kind 'notification' (table rebuilt, see 0054).
create table mail_log_new (
  id      integer primary key autoincrement,
  sent_at text not null default (now_iso()),
  kind    text not null check (kind in ('account', 'reminder', 'status', 'weekly', 'test', 'confirmation', 'notification')),
  ok      boolean not null,
  error   text
);
insert into mail_log_new (id, sent_at, kind, ok, error) select id, sent_at, kind, ok, error from mail_log;
drop table mail_log;
alter table mail_log_new rename to mail_log;
create index mail_log_sent_idx on mail_log (sent_at);

-- ---------------------------------------------------------------------------
-- Producers. auth_uid() is the account making the change (null for the
-- server itself); nobody is notified about their own changes.
-- ---------------------------------------------------------------------------

-- Probe added, changed (date, time, place) or removed — upcoming ones only.
create trigger notify_event_insert after insert on events
when new.date >= date('now', 'localtime')
begin
  insert into notification_queue (kind, ref, project_id, actor_id)
  values ('event_new', new.id, new.project_id, auth_uid());
end;

create trigger notify_event_update after update of date, time, end_time, location on events
when (new.date >= date('now', 'localtime') or old.date >= date('now', 'localtime'))
  and (new.date is not old.date or new.time is not old.time or new.end_time is not old.end_time
       or new.location is not old.location)
begin
  insert into notification_queue (kind, ref, project_id, actor_id)
  values ('event_changed', new.id, new.project_id, auth_uid());
end;

create trigger notify_event_delete after delete on events
when old.date >= date('now', 'localtime')
begin
  insert into notification_queue (kind, ref, project_id, actor_id, data)
  values ('event_cancelled', old.id, old.project_id, auth_uid(),
          json_object('name', old.name, 'date', old.date, 'time', old.time));
end;

-- Attendance: someone else marked a member excused/absent; or a member
-- excused themselves (for the people responsible for their group).
create trigger notify_attendance_insert after insert on attendance
when new.status in ('excused', 'not_attended')
begin
  insert into notification_queue (kind, ref, project_id, actor_id, data)
  select case when m.user_id = auth_uid() then 'group_absence' else 'attendance_changed' end,
         new.event_id, m.project_id, auth_uid(),
         json_object('member_id', m.id, 'user_id', m.user_id, 'status', new.status)
  from members m where m.id = new.member_id and m.user_id is not null
    and (m.user_id is not coalesce(auth_uid(), '') or new.status = 'excused');
end;

create trigger notify_attendance_update after update of status on attendance
when new.status is not old.status and new.status in ('excused', 'not_attended')
begin
  insert into notification_queue (kind, ref, project_id, actor_id, data)
  select case when m.user_id = auth_uid() then 'group_absence' else 'attendance_changed' end,
         new.event_id, m.project_id, auth_uid(),
         json_object('member_id', m.id, 'user_id', m.user_id, 'status', new.status)
  from members m where m.id = new.member_id and m.user_id is not null
    and (m.user_id is not coalesce(auth_uid(), '') or new.status = 'excused');
end;

-- An account was linked to a project's member list by someone else.
create trigger notify_member_link_insert after insert on members
when new.user_id is not null and new.status = 'active' and new.user_id is not coalesce(auth_uid(), '')
begin
  insert into notification_queue (kind, ref, project_id, actor_id, data)
  values ('project_added', new.id, new.project_id, auth_uid(), json_object('user_id', new.user_id));
end;

create trigger notify_member_link_update after update of user_id, status on members
when new.user_id is not null and new.status = 'active'
  and (old.user_id is not new.user_id or old.status <> 'active')
  and new.user_id is not coalesce(auth_uid(), '')
begin
  insert into notification_queue (kind, ref, project_id, actor_id, data)
  values ('project_added', new.id, new.project_id, auth_uid(), json_object('user_id', new.user_id));
end;

-- The project's info box changed.
create trigger notify_project_info_insert after insert on project_infos
when trim(coalesce(new.text, '')) <> ''
begin
  insert into notification_queue (kind, ref, project_id, actor_id)
  values ('project_info', new.project_id, new.project_id, auth_uid());
end;

create trigger notify_project_info_update after update of text, links on project_infos
when new.text is not old.text or new.links is not old.links
begin
  insert into notification_queue (kind, ref, project_id, actor_id)
  values ('project_info', new.project_id, new.project_id, auth_uid());
end;

-- A piece joined a project.
create trigger notify_project_piece after insert on project_pieces
begin
  insert into notification_queue (kind, ref, project_id, actor_id)
  values ('piece_added', new.piece_id, new.project_id, auth_uid());
end;

-- Intake for the people managing the project.
create trigger notify_registration after insert on registrations
begin
  insert into notification_queue (kind, ref, project_id, actor_id)
  select 'registration_new', new.registration_page_id, rp.project_id, auth_uid()
  from registration_pages rp where rp.id = new.registration_page_id;
end;

create trigger notify_checkin_unrecognized after insert on checkin_submissions
when not new.recognized
begin
  insert into notification_queue (kind, ref, project_id, actor_id)
  select 'checkin_unrecognized', new.event_id, e.project_id, auth_uid()
  from events e where e.id = new.event_id;
end;

-- An admin changed the account's role.
create trigger notify_role_change after update of role on app_users
when new.role is not old.role and new.id is not coalesce(auth_uid(), '')
begin
  insert into notification_queue (kind, ref, actor_id, data)
  values ('account_role', new.id, auth_uid(), json_object('role', new.role));
end;
