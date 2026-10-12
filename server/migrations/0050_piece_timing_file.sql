-- Bar timing exported by MuseScore (`mscore -o piece.mpos piece.mscz`): the
-- exact time every bar starts as MuseScore plays it, repeats unfolded. A
-- piece names the .mpos its bars are read from, picked from its files (kept
-- as notation files; the kind's check constraint can't change without
-- rebuilding the table).
alter table pieces add column timing_file_id text references piece_files (id) on delete set null;
