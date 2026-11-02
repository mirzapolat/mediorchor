-- Papierkorb: deleting a project, Probe, member, piece, survey, registration
-- page or registration, concert, group, calendar or absence label keeps a
-- snapshot of it and of everything that went with it (attendance, answers,
-- files, ...) for 30 days, from which it can be restored as it was
-- (server/trash.ts). Stored files stay until the entry is gone.
-- No data-API policy: only the server's functions read these tables.

create table trash (
  id              text primary key default (uuid()),
  -- Table of the deleted row (projects, events, members, ...).
  kind            text not null,
  root_id         text not null,
  -- The project it belonged to (no foreign key: it may be gone too); for a
  -- deleted project its own id; null for pieces and calendars.
  project_id      text,
  project_name    text,
  label           text not null,
  -- Rows per table that went with it, e.g. {"attendance": 120}.
  contents        json not null default '{}',
  deleted_by      text,
  deleted_by_name text,
  deleted_at      text not null default (now_iso()),
  expires_at      text not null
);
create index trash_project_idx on trash (project_id, deleted_at);
create index trash_expires_idx on trash (expires_at);

-- The deleted rows, in the order they are inserted again.
create table trash_rows (
  trash_id   text not null references trash (id) on delete cascade,
  seq        integer not null,
  table_name text not null,
  data       json not null,
  primary key (trash_id, seq)
) without rowid;
create index trash_rows_table_idx on trash_rows (table_name);

-- Values the deletion cleared in rows that stay (a member's link from a
-- registration, members' group after deleting the group), put back on
-- restore where still empty.
create table trash_values (
  trash_id   text not null references trash (id) on delete cascade,
  table_name text not null,
  row_key    json not null,
  column_name text not null,
  value      json
);
create index trash_values_trash_idx on trash_values (trash_id);
