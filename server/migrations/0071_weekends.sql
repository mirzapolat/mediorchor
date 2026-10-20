-- Rehearsal weekends ("Probenwochenende"): any number per project. Each has
-- its general information (seen by the project's participants once
-- published), its own list of participants — kept apart from the project's
-- members — and rooms that confirmed participants choose themselves.
create table weekends (
  id          text primary key default (uuid()),
  project_id  text not null references projects (id) on delete cascade,
  title       text not null,
  starts_on   text,              -- YYYY-MM-DD
  ends_on     text,              -- YYYY-MM-DD
  location    text not null default '',
  description text not null default '',   -- Markdown
  -- An external sign-up (form, tool); shown to participants as a button.
  signup_url  text,
  status      text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  archived    boolean not null default 0,
  created_at  text not null default (now_iso()),
  check (starts_on is null or starts_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  check (ends_on is null or ends_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  check (starts_on is null or ends_on is null or ends_on >= starts_on)
);
create index weekends_project on weekends (project_id, starts_on);

-- Each import of names/emails: where from, who, when and what it did, so
-- the last one can be undone (only the entries it made, unchanged since).
create table weekend_imports (
  id              text primary key default (uuid()),
  weekend_id      text not null references weekends (id) on delete cascade,
  source          text not null check (source in ('csv', 'paste')),
  file_name       text,
  created_by      text references app_users (id) on delete set null,
  created_by_name text not null default '',
  stats           json not null default '{}',
  undone_at       text,
  created_at      text not null default (now_iso())
);
create index weekend_imports_weekend on weekend_imports (weekend_id, created_at);

-- Who takes part. `kind`: a confirmed member/account ('member'), a
-- confirmed guest without an account ('guest'), or not yet resolved
-- ('pending'). Only confirmed entries open the rooms.
create table weekend_participants (
  id              text primary key default (uuid()),
  weekend_id      text not null references weekends (id) on delete cascade,
  kind            text not null check (kind in ('member', 'guest', 'pending')),
  member_id       text references members (id) on delete set null,
  user_id         text references app_users (id) on delete set null,
  name            text not null,
  email           text,
  group_name      text,
  -- As the import had it.
  source_name     text,
  source_email    text,
  import_id       text references weekend_imports (id) on delete set null,
  -- Changed by hand after the import (an undo leaves it alone).
  changed_by_hand boolean not null default 0,
  created_at      text not null default (now_iso()),
  updated_at      text not null default (now_iso())
);
create index weekend_participants_weekend on weekend_participants (weekend_id);
create unique index weekend_participants_member on weekend_participants (weekend_id, member_id) where member_id is not null;
create unique index weekend_participants_user on weekend_participants (weekend_id, user_id) where user_id is not null;

create table weekend_rooms (
  id          text primary key default (uuid()),
  weekend_id  text not null references weekends (id) on delete cascade,
  name        text not null,
  description text not null default '',
  capacity    integer not null check (capacity > 0),
  position    integer not null default 0,
  created_at  text not null default (now_iso())
);
create index weekend_rooms_weekend on weekend_rooms (weekend_id, position);

-- Who sleeps where: one room per participant. Capacity is checked whenever a
-- place is taken; an occupied room can't be deleted (server/policies.ts).
create table weekend_room_assignments (
  participant_id text primary key references weekend_participants (id) on delete cascade,
  room_id        text not null references weekend_rooms (id) on delete cascade,
  assigned_by    text references app_users (id) on delete set null,
  assigned_at    text not null default (now_iso())
);
create index weekend_room_assignments_room on weekend_room_assignments (room_id);

-- Who may see each contact detail in a weekend's rooms: nobody else
-- ('private'), the weekend's confirmed participants ('weekend') or only the
-- people sharing one's room ('room').
alter table account_contacts add column room_share text not null default 'private'
  check (room_share in ('private', 'weekend', 'room'));
