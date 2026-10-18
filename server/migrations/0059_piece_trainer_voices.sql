-- Which voices of a piece's trainer MusicXML a project group sings: set in
-- the piece's configuration, per project (groups belong to one). A member
-- of a mapped group picks only among its voices in the trainer (with one,
-- there is no choice); unmapped groups pick among all. `track_id` is the
-- trainer's voice id ("<part index>:<voice>").
create table piece_trainer_voices (
  piece_id text not null references pieces (id) on delete cascade,
  group_id text not null references project_groups (id) on delete cascade,
  track_id text not null,
  primary key (piece_id, group_id, track_id)
);
create index piece_trainer_voices_group on piece_trainer_voices (group_id);
