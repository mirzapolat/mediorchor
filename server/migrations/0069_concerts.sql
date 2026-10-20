-- Concerts of a project (any number): when and where, a description, the
-- dress code, a running order of their own and recordings. Managers keep
-- them as a draft until they publish them; participants only ever see
-- published ones that aren't archived. A date in the past archives nothing.
create table concerts (
  id          text primary key default (uuid()),
  project_id  text not null references projects (id) on delete cascade,
  title       text not null,
  date        text,               -- YYYY-MM-DD
  time        text,               -- HH:MM
  end_time    text,               -- HH:MM
  location    text not null default '',
  description text not null default '',   -- Markdown
  dress_code  text not null default '',   -- Markdown
  status      text not null default 'draft' check (status in ('draft', 'published')),
  archived    boolean not null default 0,
  created_at  text not null default (now_iso()),
  check (date is null or date glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  check (time is null or time glob '[0-2][0-9]:[0-5][0-9]'),
  check (end_time is null or end_time glob '[0-2][0-9]:[0-5][0-9]')
);
create index concerts_project on concerts (project_id, date);

-- The programme: project pieces, free headings, the interval and encores
-- (a piece or a free title), independent of any Probe's programme.
create table concert_program_items (
  id         text primary key default (uuid()),
  concert_id text not null references concerts (id) on delete cascade,
  kind       text not null check (kind in ('piece', 'heading', 'break', 'encore')),
  piece_id   text references pieces (id) on delete set null,
  title      text not null default '',
  note       text not null default '',
  position   integer not null default 0,
  created_at text not null default (now_iso())
);
create index concert_program_items_concert on concert_program_items (concert_id, position);

-- Recordings: a stored file ("<concertId>/<uuid>.<ext>" in the private
-- concert-files bucket) or an external link, for the whole concert or one
-- programme item. Never public.
create table concert_recordings (
  id               text primary key default (uuid()),
  concert_id       text not null references concerts (id) on delete cascade,
  item_id          text references concert_program_items (id) on delete set null,
  kind             text not null check (kind in ('file', 'link')),
  title            text not null default '',
  file_path        text,
  file_name        text,
  mime             text,
  url              text,
  size             integer,
  file_missing     boolean not null default 0,
  uploaded_by_name text not null default '',
  position         integer not null default 0,
  created_at       text not null default (now_iso()),
  check ((kind = 'file' and file_path is not null) or (kind = 'link' and url is not null))
);
create index concert_recordings_concert on concert_recordings (concert_id, position);
create index concert_recordings_file on concert_recordings (file_path);

-- Deleted recordings wait here (30 days, as a piece's files) until restored
-- or deleted for good; `row` is the recording as it was.
create table concert_recording_trash (
  id              text primary key default (uuid()),
  concert_id      text not null references concerts (id) on delete cascade,
  recording_id    text not null,
  row             json not null,
  deleted_by_name text not null default '',
  deleted_at      text not null default (now_iso())
);
create index concert_recording_trash_concert on concert_recording_trash (concert_id, deleted_at);
