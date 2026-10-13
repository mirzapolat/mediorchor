-- Which of a piece's files members may download. A recording a voice uses
-- follows its voice (piece_tracks.downloadable); every other file has its
-- own switch. Everything stays downloadable as before until switched off.
alter table piece_files add column downloadable boolean not null default 1;
alter table piece_tracks add column downloadable boolean not null default 1;
