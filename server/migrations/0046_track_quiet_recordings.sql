-- A voice can carry four recordings of the same MIDI: the other voices
-- muted (file_id, click_file_id, as before) or quietly in the background
-- (the two below), each without and with metronome click. Same timing, so
-- the voice's lead-in applies to all four.
alter table piece_tracks add column quiet_file_id text references piece_files (id) on delete set null;
alter table piece_tracks add column quiet_click_file_id text references piece_files (id) on delete set null;
