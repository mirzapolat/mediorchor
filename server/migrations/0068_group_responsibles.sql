-- Who looks after a group (organisational only — it grants no rights) and an
-- internal note on it, kept by those who manage the project. In tables of
-- their own: participants read project_groups, but never these.
create table group_responsibles (
  id         text primary key default (uuid()),
  group_id   text not null references project_groups (id) on delete cascade,
  user_id    text not null references app_users (id) on delete cascade,
  position   integer not null default 0,
  created_at text not null default (now_iso()),
  unique (group_id, user_id)
);
create index group_responsibles_user on group_responsibles (user_id);

create table group_notes (
  group_id   text primary key references project_groups (id) on delete cascade,
  note       text not null default '',
  updated_at text not null default (now_iso())
);
