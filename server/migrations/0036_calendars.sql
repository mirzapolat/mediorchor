-- Kalender (dashboard tab): calendars that collect the rehearsals of their
-- projects plus events of their own, subscribable as an iCal feed.

-- A rehearsal's end (HH:MM); without one it lasts an hour.
alter table events add column end_time text;
-- Unticked in a rehearsal's settings, it stays out of every calendar.
alter table events add column in_calendar boolean not null default 1;

create table calendars (
  id         text primary key default (uuid()),
  name       text not null,
  color      text not null default '#0284c7',
  -- The unguessable feed URL's credential; a new token revokes the old link.
  feed_token text not null unique default (uuid()),
  position   integer not null default 0,
  created_at text not null default (now_iso())
);

create table calendar_projects (
  id          text primary key default (uuid()),
  calendar_id text not null references calendars (id) on delete cascade,
  project_id  text not null references projects (id) on delete cascade,
  created_at  text not null default (now_iso()),
  unique (calendar_id, project_id)
);
create index calendar_projects_project_idx on calendar_projects (project_id);

-- Events outside any project (the calendar's "Events" entry). Times are
-- local HH:MM like the rehearsals'; no start time = all day.
create table calendar_events (
  id          text primary key default (uuid()),
  calendar_id text not null references calendars (id) on delete cascade,
  name        text not null,
  date        text not null,
  start_time  text,
  end_time    text,
  location    text,
  notes       text,
  link        text,
  created_at  text not null default (now_iso())
);
create index calendar_events_calendar_idx on calendar_events (calendar_id, date);
