-- A rehearsal's programme: pieces from the project's collection assigned to an
-- event in running order, each with a short note ("T. 1–30, nur Sopran"),
-- plus one general note for the whole rehearsal.

alter table events add column program_note text not null default '';

create table event_pieces (
  id         text primary key default (uuid()),
  event_id   text not null references events (id) on delete cascade,
  piece_id   text not null references pieces (id) on delete cascade,
  note       text not null default '',
  position   integer not null default 0,
  created_at text not null default (now_iso()),
  unique (event_id, piece_id)
);
create index event_pieces_event_idx on event_pieces (event_id, position);
create index event_pieces_piece_idx on event_pieces (piece_id);
