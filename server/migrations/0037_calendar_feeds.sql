-- Kalender, round two: reliable updates in subscribed apps, multi-day and
-- repeating manual events, default reminders, and several named links per
-- calendar (each with its own detail level, also opening a public web view).

-- Change tracking for the feed (SEQUENCE / LAST-MODIFIED): apps re-read an
-- entry whose sequence went up. Only fields the feed shows count.
alter table events add column sequence integer not null default 0;
alter table events add column updated_at text;

create trigger events_feed_revision
after update of name, date, time, end_time, location, description, in_calendar on events
for each row
begin
  update events set sequence = sequence + 1, updated_at = now_iso() where id = new.id;
end;

-- Manual events: an optional last day (multi-day) and a simple repeat rule —
-- every `repeat_interval` days/weeks/months/years from `date`, up to and
-- including `repeat_until` (open-ended without).
alter table calendar_events add column end_date text;
alter table calendar_events add column repeat text not null default 'none'
  check (repeat in ('none', 'daily', 'weekly', 'monthly', 'yearly'));
alter table calendar_events add column repeat_interval integer not null default 1
  check (repeat_interval between 1 and 99);
alter table calendar_events add column repeat_until text;
alter table calendar_events add column sequence integer not null default 0;
alter table calendar_events add column updated_at text;

create trigger calendar_events_feed_revision
after update of name, date, end_date, start_time, end_time, location, notes, link,
  repeat, repeat_interval, repeat_until on calendar_events
for each row
begin
  update calendar_events set sequence = sequence + 1, updated_at = now_iso() where id = new.id;
end;

-- Default reminder for every entry of a calendar, in minutes before the start
-- (all-day entries: before midnight). Null = none.
alter table calendars add column reminder_minutes integer
  check (reminder_minutes is null or reminder_minutes between 0 and 40320);

-- Subscription links. Each has its own unguessable token (the credential);
-- show_details = false leaves out location, notes and links. The same token
-- opens the public web view (/cal/<token>). calendars.feed_token is no longer
-- used: it can't be dropped in SQLite while it carries a unique constraint.
create table calendar_links (
  id              text primary key default (uuid()),
  calendar_id     text not null references calendars (id) on delete cascade,
  name            text not null,
  token           text not null unique default (uuid()),
  show_details    boolean not null default 1,
  last_fetched_at text,
  created_at      text not null default (now_iso())
);
create index calendar_links_calendar_idx on calendar_links (calendar_id);

-- Existing subscriptions keep working under their old token.
insert into calendar_links (calendar_id, name, token, created_at)
select id, 'Standard', feed_token, created_at from calendars;

-- A new calendar starts with one link.
create trigger calendars_default_link
after insert on calendars
for each row
begin
  insert into calendar_links (calendar_id, name) values (new.id, 'Standard');
end;

-- Single occurrences of a repeating manual event, keyed by the date they
-- originally fall on: cancelled, or replaced by these values (a full copy,
-- so later edits to the series leave a changed occurrence as it is).
create table calendar_event_exceptions (
  id              text primary key default (uuid()),
  event_id        text not null references calendar_events (id) on delete cascade,
  occurrence_date text not null,
  cancelled       boolean not null default 0,
  name            text not null,
  date            text not null,
  end_date        text,
  start_time      text,
  end_time        text,
  location        text,
  notes           text,
  link            text,
  sequence        integer not null default 0,
  updated_at      text,
  created_at      text not null default (now_iso()),
  unique (event_id, occurrence_date)
);

create trigger calendar_event_exceptions_revision
after update of cancelled, name, date, end_date, start_time, end_time, location, notes, link
  on calendar_event_exceptions
for each row
begin
  update calendar_event_exceptions set sequence = sequence + 1, updated_at = now_iso() where id = new.id;
end;

-- The series itself changes too (its EXDATE list), so apps re-read it.
create trigger calendar_event_exceptions_series_insert
after insert on calendar_event_exceptions
for each row
begin
  update calendar_events set sequence = sequence + 1, updated_at = now_iso() where id = new.event_id;
end;

create trigger calendar_event_exceptions_series_update
after update of cancelled on calendar_event_exceptions
for each row
begin
  update calendar_events set sequence = sequence + 1, updated_at = now_iso() where id = new.event_id;
end;

create trigger calendar_event_exceptions_series_delete
after delete on calendar_event_exceptions
for each row
begin
  update calendar_events set sequence = sequence + 1, updated_at = now_iso() where id = old.event_id;
end;
