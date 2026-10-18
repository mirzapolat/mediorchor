-- The singing trainer (src/tonetrainer): a piece is practised with the
-- microphone once a MusicXML is connected to its trainer node in the setup.
-- Can be the same file the bars are read from, or another one.
alter table pieces add column trainer_file_id text references piece_files (id) on delete set null;

-- What each account practised: one row per run through a voice (the
-- trainer's SessionRecord as JSON, measures keyed by 0-based measure index).
-- Only its owner sees it.
create table practice_sessions (
  id         text primary key,
  user_id    text not null references app_users (id) on delete cascade,
  piece_id   text not null references pieces (id) on delete cascade,
  started_at integer not null,
  data       json not null,
  created_at text not null default (now_iso())
);
create index practice_sessions_user_piece on practice_sessions (user_id, piece_id, started_at);

-- Per account and piece: the voice sung, mixer, zoom and tempo.
create table practice_prefs (
  user_id  text not null references app_users (id) on delete cascade,
  piece_id text not null references pieces (id) on delete cascade,
  prefs    json not null default '{}',
  primary key (user_id, piece_id)
);
