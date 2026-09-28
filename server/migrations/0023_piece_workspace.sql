-- Pieces become one practice workspace instead of a list of loose blocks:
-- the piece owns its files (score PDF, notation, MIDI, one audio track per
-- voice, other files and links), its notes, one bar timeline shared by all
-- audio tracks, and one set of bar markers on the score PDF.

alter table pieces add column description text not null default '';
alter table pieces add column notes text not null default '';
-- Played bar sequence (repeats unfolded), computed in the browser from the
-- notation file or from an even bar range. Shape: see PieceTimeline (src/types).
alter table pieces add column timeline json;
-- Position of each bar's marker on the score PDF, keyed by bar label.
alter table pieces add column bar_anchors json not null default '{}';

create table piece_files (
  id         text primary key default (uuid()),
  piece_id   text not null references pieces (id) on delete cascade,
  kind       text not null check (kind in ('score', 'notation', 'midi', 'audio', 'other', 'link')),
  -- Display name; for audio tracks the voice (Sopran, Alt, Tutti, …).
  title      text not null default '',
  url        text,
  file_path  text,
  file_name  text,
  -- Audio only: seconds of lead-in before the first bar starts.
  offset_s   real not null default 0,
  position   integer not null default 0,
  created_at text not null default (now_iso())
);
create index piece_files_piece_idx on piece_files (piece_id, kind, position);

-- ---------------------------------------------------------------------------
-- Carry over existing blocks
-- ---------------------------------------------------------------------------

-- Files and audio keep their storage objects; files are sorted by extension.
insert into piece_files (piece_id, kind, title, url, file_path, file_name, position, created_at)
select
  piece_id,
  case
    when type = 'audio' then 'audio'
    when type = 'link' then 'link'
    when lower(file_name) like '%.pdf' then 'score'
    when lower(file_name) like '%.musicxml' or lower(file_name) like '%.mxl'
      or lower(file_name) like '%.xml' then 'notation'
    when lower(file_name) like '%.mid' or lower(file_name) like '%.midi' then 'midi'
    else 'other'
  end,
  title, url, file_path, file_name, position, created_at
from piece_blocks
where type in ('file', 'audio', 'link');

-- Score PDFs that were attached to an audio block's practice page. They carry
-- the bar markers, so they go first (the first score is the one shown).
insert into piece_files (piece_id, kind, title, file_path, file_name, position, created_at)
select piece_id, 'score', coalesce(score_name, ''), score_path, score_name, -1, created_at
from piece_blocks
where score_path is not null;

-- Text blocks become the piece's notes (one section per block).
update pieces set notes = coalesce((
  select group_concat(section, char(10) || char(10))
  from (
    select '## ' || title || char(10) || char(10) || coalesce(content, '') as section
    from piece_blocks b
    where b.piece_id = pieces.id and b.type = 'text'
    order by b.position, b.created_at
  )
), '');

-- The first audio block with bars defines the (evenly spaced) timeline and
-- brings its bar markers along.
update pieces set
  timeline = (
    select json_object('source', 'even', 'first', bars_start, 'last', bars_end)
    from piece_blocks b
    where b.piece_id = pieces.id and b.type = 'audio' and b.has_bars
    order by b.position, b.created_at limit 1
  ),
  bar_anchors = coalesce((
    select bar_anchors
    from piece_blocks b
    where b.piece_id = pieces.id and b.type = 'audio' and b.has_bars and b.score_path is not null
    order by b.position, b.created_at limit 1
  ), '{}');

drop table piece_blocks;
