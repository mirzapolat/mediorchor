-- Two ways to set up a piece's practice recordings:
--   * 'variants' (as so far): every voice has up to four exports — other
--     voices muted or quiet, each without and with metronome click;
--   * 'mixer': every voice has one recording (the voice alone) and the
--     piece has one metronome track; the player's mixer puts together
--     whatever is wanted.
-- The metronome track is a piece_tracks row of kind 'click' (its recording
-- in file_id), so access rules, downloads, trash/restore and offline saving
-- treat it like a voice. Existing pieces stay 'variants'.
alter table pieces add column track_mode text not null default 'variants'
  check (track_mode in ('variants', 'mixer'));
alter table piece_tracks add column kind text not null default 'voice'
  check (kind in ('voice', 'click'));
