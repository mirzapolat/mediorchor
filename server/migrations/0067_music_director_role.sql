-- migrate: foreign_keys=off
-- A fifth role, "Musikalische Leitung" (music_director): every project with
-- all its content and every piece, like Verwaltung, but never a member of a
-- project — no "Meine Teilnahme", no joining, no attendance — and no
-- deleting projects. The role list is a CHECK on app_users.role, so the
-- table is rebuilt (SQLite can't change a CHECK in place).

-- Triggers of other tables that read app_users would stop the rename;
-- they go first and come back unchanged below.
drop trigger members_photo_from_account_insert;
drop trigger members_photo_from_account_update;
drop trigger pieces_credit_photo_from_account_insert;
drop trigger pieces_credit_photo_from_account_update;
drop trigger piece_credits_photo_insert;
drop trigger piece_credits_photo_update;

create table app_users_new (
  id                   text primary key references auth_users (id) on delete cascade,
  email                text not null,
  created_at           text not null default (now_iso()),
  photo_url            text,
  photo_prompted_at    text,
  approved             boolean not null default 1,
  notify_reminders     boolean not null default 0,
  notify_status        boolean not null default 0,
  notify_weekly        boolean not null default 0,
  first_name           text not null default '',
  last_name            text not null default '',
  name                 text generated always as (trim(first_name || ' ' || last_name)) virtual,
  home_page            text not null default 'dashboard'
    check (home_page in ('dashboard', 'projects', 'pieces', 'calendar')),
  dashboard_layout     json not null default '[]',
  role                 text not null default 'participant'
    check (role in ('participant', 'section_lead', 'manager', 'music_director', 'admin')),
  language             text,
  contacts_prompted_at text
);

insert into app_users_new (
  id, email, created_at, photo_url, photo_prompted_at, approved, notify_reminders, notify_status, notify_weekly,
  first_name, last_name, home_page, dashboard_layout, role, language, contacts_prompted_at
)
select
  id, email, created_at, photo_url, photo_prompted_at, approved, notify_reminders, notify_status, notify_weekly,
  first_name, last_name, home_page, dashboard_layout, role, language, contacts_prompted_at
from app_users;

drop table app_users;
alter table app_users_new rename to app_users;

-- The table's own triggers went with it: as before.
create trigger app_users_sync_member_photo
after update of photo_url on app_users
for each row
when new.photo_url is not old.photo_url
begin
  update members set photo_url = new.photo_url where user_id = new.id;
end;

create trigger app_users_sync_piece_credit_photo
after update of photo_url on app_users
for each row
when new.photo_url is not old.photo_url
begin
  update pieces set midi_credit_photo_url = new.photo_url where midi_credit_user_id = new.id;
end;

create trigger app_users_sync_credit_photo
after update of photo_url on app_users
for each row
when new.photo_url is not old.photo_url
begin
  update piece_credits set photo_url = new.photo_url where user_id = new.id;
end;

create trigger app_users_sync_member_names
after update of first_name, last_name on app_users
for each row
when trim(new.first_name || new.last_name) <> ''
  and (new.first_name is not old.first_name or new.last_name is not old.last_name)
begin
  update members
  set first_name = trim(new.first_name),
      last_name = trim(new.last_name)
  where user_id = new.id;
end;

create trigger app_users_email_lower_insert after insert on app_users
when new.email is not ulower(trim(new.email))
begin
  update app_users set email = ulower(trim(new.email)) where rowid = new.rowid;
end;

create trigger app_users_email_lower_update after update of email on app_users
when new.email is not ulower(trim(new.email))
begin
  update app_users set email = ulower(trim(new.email)) where rowid = new.rowid;
end;

-- The other tables' triggers reading app_users, as before.
create trigger members_photo_from_account_insert
after insert on members
for each row
begin
  update members
  set photo_url = (select u.photo_url from app_users u where u.id = new.user_id)
  where id = new.id;
end;

create trigger members_photo_from_account_update
after update of user_id on members
for each row
when new.user_id is not old.user_id
begin
  update members
  set photo_url = (select u.photo_url from app_users u where u.id = new.user_id)
  where id = new.id;
end;

create trigger pieces_credit_photo_from_account_insert
after insert on pieces
for each row
when new.midi_credit_user_id is not null
begin
  update pieces
  set midi_credit_photo_url = (select u.photo_url from app_users u where u.id = new.midi_credit_user_id)
  where id = new.id;
end;

create trigger pieces_credit_photo_from_account_update
after update of midi_credit_user_id on pieces
for each row
when new.midi_credit_user_id is not old.midi_credit_user_id
begin
  update pieces
  set midi_credit_photo_url = (select u.photo_url from app_users u where u.id = new.midi_credit_user_id)
  where id = new.id;
end;

create trigger piece_credits_photo_insert
after insert on piece_credits
for each row
begin
  update piece_credits
  set photo_url = (select u.photo_url from app_users u where u.id = new.user_id)
  where id = new.id;
end;

create trigger piece_credits_photo_update
after update of user_id on piece_credits
for each row
when new.user_id is not old.user_id
begin
  update piece_credits
  set photo_url = (select u.photo_url from app_users u where u.id = new.user_id)
  where id = new.id;
end;

-- The music director is never a member: no member row links to such an
-- account, whichever way it would (the server refuses the ways it knows of;
-- this catches any other), and an account given the role leaves its member
-- rows (they and their attendance stay, unlinked).
create trigger members_no_music_director_insert
after insert on members
for each row
when new.user_id is not null
  and exists (select 1 from app_users u where u.id = new.user_id and u.role = 'music_director')
begin
  update members set user_id = null where id = new.id;
end;

create trigger members_no_music_director_update
after update of user_id on members
for each row
when new.user_id is not null
  and exists (select 1 from app_users u where u.id = new.user_id and u.role = 'music_director')
begin
  update members set user_id = null where id = new.id;
end;

create trigger app_users_music_director_unlink
after update of role on app_users
for each row
when new.role = 'music_director' and old.role is not 'music_director'
begin
  update members set user_id = null where user_id = new.id;
end;
