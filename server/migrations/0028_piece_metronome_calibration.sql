-- Metronome correction per piece, set from the metronome debug view: clicks
-- are stretched around bar one (speed, 1 = as in the notation file) and
-- moved (shift, seconds).
alter table pieces add column metronome_speed real not null default 1;
alter table pieces add column metronome_shift real not null default 0;
