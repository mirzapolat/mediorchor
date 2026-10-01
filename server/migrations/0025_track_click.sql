-- Audio only: the recording already has a metronome (click track) in it, so
-- the player doesn't offer its own.
alter table piece_files add column has_click boolean not null default 0;
