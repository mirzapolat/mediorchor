-- The browser metronome is gone: instead every voice track can carry a
-- second recording of the same MIDI with a click in it, and the player
-- switches between the two. Same timing, so the track's lead-in applies to
-- both.
alter table piece_files add column click_file_path text;
alter table piece_files add column click_file_name text;

alter table piece_files drop column has_click;
alter table pieces drop column metronome_speed;
alter table pieces drop column metronome_shift;
