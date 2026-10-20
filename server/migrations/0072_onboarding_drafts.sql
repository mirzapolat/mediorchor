-- A project being set up (the one-page onboarding): saved while typing so it
-- survives a reload or another device. Only its own account ever reads it;
-- it is no project yet. Creating the project (or discarding the draft)
-- removes it.
create table onboarding_drafts (
  user_id    text primary key references app_users (id) on delete cascade,
  data       json not null default '{}',
  updated_at text not null default (now_iso())
);
