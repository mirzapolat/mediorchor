-- The piece set-up page is rebuilt around one list of uploaded files:
--   * voices (piece_tracks) point at uploaded recordings, one without and
--     one with metronome click, instead of being file rows themselves; a
--     recording with click becomes a file row of its own;
--   * a piece names the score PDF shown on its page and the MusicXML its
--     bars are read from (both picked from its files);
--   * a piece has a length of its own (set from the MusicXML, editable);
--   * credits are several people, each with a role ("made the MIDIs" when
--     left empty).
-- The old columns (piece_files.click_file_*, pieces.midi_credit_*) stay
-- unused, so nothing is lost; they reference other tables and can't be
-- dropped without rebuilding them.

alter table pieces add column duration_s real;
alter table pieces add column score_file_id text references piece_files (id) on delete set null;
alter table pieces add column notation_file_id text references piece_files (id) on delete set null;

-- Voices -----------------------------------------------------------------

create table piece_tracks (
  id            text primary key default (uuid()),
  piece_id      text not null references pieces (id) on delete cascade,
  -- The voice (Sopran, Alt, Tutti, …).
  title         text not null default '',
  file_id       text references piece_files (id) on delete set null,
  click_file_id text references piece_files (id) on delete set null,
  -- Seconds of lead-in before the first bar (same for both recordings).
  offset_s      real not null default 0,
  position      integer not null default 0,
  created_at    text not null default (now_iso())
);
create index piece_tracks_piece_idx on piece_tracks (piece_id, position);

-- Every voice recording becomes a voice pointing at it.
insert into piece_tracks (piece_id, title, file_id, offset_s, position, created_at)
select piece_id, title, id, offset_s, position, created_at
from piece_files
where kind = 'audio' and file_path is not null;

-- Its recording with click becomes a file of its own …
insert into piece_files (piece_id, kind, title, file_path, file_name, offset_s, position, created_at)
select piece_id, 'audio', trim(title || ' (Metronom)'), click_file_path, click_file_name, offset_s,
  position + 1000, created_at
from piece_files
where kind = 'audio' and click_file_path is not null;

-- … that the voice points at as well.
update piece_tracks set click_file_id = (
  select nf.id from piece_files f join piece_files nf on nf.file_path = f.click_file_path
  where f.id = piece_tracks.file_id
)
where file_id in (select id from piece_files where click_file_path is not null);

update piece_files set click_file_path = null, click_file_name = null where click_file_path is not null;

-- Score and notation: the first of each, as the pages picked them so far.
update pieces set
  score_file_id = (
    select id from piece_files f where f.piece_id = pieces.id and f.kind = 'score' and f.file_path is not null
    order by f.position, f.created_at limit 1
  ),
  notation_file_id = (
    select id from piece_files f where f.piece_id = pieces.id and f.kind = 'notation' and f.file_path is not null
    order by f.position, f.created_at limit 1
  );

-- Credits ----------------------------------------------------------------

create table piece_credits (
  id         text primary key default (uuid()),
  piece_id   text not null references pieces (id) on delete cascade,
  name       text not null default '',
  -- Optionally linked to an account, whose profile photo is mirrored here.
  user_id    text references app_users (id) on delete set null,
  photo_url  text,
  -- What they did; empty means "made the MIDIs".
  role       text not null default '',
  position   integer not null default 0,
  created_at text not null default (now_iso())
);
create index piece_credits_piece_idx on piece_credits (piece_id, position);

insert into piece_credits (piece_id, name, user_id, photo_url, created_at)
select id, midi_credit_name, midi_credit_user_id, midi_credit_photo_url, created_at
from pieces
where trim(midi_credit_name) <> '';

create trigger app_users_sync_credit_photo
after update of photo_url on app_users
for each row
when new.photo_url is not old.photo_url
begin
  update piece_credits set photo_url = new.photo_url where user_id = new.id;
end;

create trigger piece_credits_photo_insert
after insert on piece_credits
for each row
begin
  update piece_credits
  set photo_url = (select u.photo_url from app_users u where u.id = new.user_id)
  where id = new.id;
end;

create trigger piece_credits_photo_update
after update of user_id on piece_credits
for each row
when new.user_id is not old.user_id
begin
  update piece_credits
  set photo_url = (select u.photo_url from app_users u where u.id = new.user_id)
  where id = new.id;
end;
