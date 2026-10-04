-- migrate: foreign_keys=off
-- Pieces become one collection shared by all projects: a piece no longer
-- belongs to a project, projects pick pieces from the collection (each with
-- its own running order). Everything else about a piece (files, voices, bar
-- markers, notes, credits) is the same in every project.
--
-- Accounts get a pieces permission: 'all' edits the whole collection (and
-- opens its page), 'projects' edits the pieces of projects one manages,
-- 'none' edits no piece content. Project managers can always add, remove and
-- order the pieces of their projects.

-- Rebuild pieces without project_id/position, with an archive flag.
drop trigger app_users_sync_piece_credit_photo;

create table pieces_new (
  id                    text primary key default (uuid()),
  name                  text not null,
  composer              text not null default '',
  description           text not null default '',
  notes                 text not null default '',
  timeline              json,
  bar_anchors           json not null default '{}',
  bar_shift             integer not null default 0,
  midi_credit_name      text not null default '',
  midi_credit_user_id   text references app_users (id) on delete set null,
  midi_credit_photo_url text,
  markers_locked_by     text references app_users (id) on delete set null,
  markers_locked_name   text,
  markers_locked_at     text,
  archived              boolean not null default 0,
  created_at            text not null default (now_iso())
);

insert into pieces_new (
  id, name, composer, description, notes, timeline, bar_anchors, bar_shift,
  midi_credit_name, midi_credit_user_id, midi_credit_photo_url,
  markers_locked_by, markers_locked_name, markers_locked_at, created_at
)
select
  id, name, composer, description, notes, timeline, bar_anchors, bar_shift,
  midi_credit_name, midi_credit_user_id, midi_credit_photo_url,
  markers_locked_by, markers_locked_name, markers_locked_at, created_at
from pieces;

-- Which pieces a project uses, in its running order.
create table project_pieces (
  id         text primary key default (uuid()),
  project_id text not null references projects (id) on delete cascade,
  piece_id   text not null references pieces (id) on delete cascade,
  position   integer not null default 0,
  created_at text not null default (now_iso()),
  unique (project_id, piece_id)
);

-- Every existing piece stays in its project, in the same order.
insert into project_pieces (project_id, piece_id, position, created_at)
select project_id, id, position, created_at from pieces;

drop table pieces;
alter table pieces_new rename to pieces;

create index project_pieces_project_idx on project_pieces (project_id, position);
create index project_pieces_piece_idx on project_pieces (piece_id);

-- The MIDI credit photo mirrors the linked account's (as in 0026).
create trigger app_users_sync_piece_credit_photo
after update of photo_url on app_users
for each row
when new.photo_url is not old.photo_url
begin
  update pieces set midi_credit_photo_url = new.photo_url where midi_credit_user_id = new.id;
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

-- A piece taken out of a project also leaves that project's rehearsal
-- programmes.
create trigger project_pieces_remove_from_programs
after delete on project_pieces
for each row
begin
  delete from event_pieces
  where piece_id = old.piece_id
    and event_id in (select id from events where project_id = old.project_id);
end;

alter table app_users add column piece_access text not null default 'none'
  check (piece_access in ('none', 'projects', 'all'));

-- Whoever manages projects today keeps editing the pieces of their projects.
update app_users set piece_access = 'projects'
where not is_admin
  and (can_manage_projects or exists (select 1 from user_projects up where up.user_id = app_users.id));
