-- ============================================================================
-- Bar (Takt) metadata for audio blocks.
-- An audio block can declare that the recording spans bars bars_start to
-- bars_end of the score. The app then offers a practice page where playback
-- can be started at any specific bar.
-- ============================================================================

alter table public.piece_blocks
  add column if not exists has_bars boolean not null default false,
  add column if not exists bars_start int,
  add column if not exists bars_end int;

alter table public.piece_blocks
  drop constraint if exists piece_blocks_bars_check;
alter table public.piece_blocks
  add constraint piece_blocks_bars_check
  check (not has_bars or (bars_start >= 1 and bars_end >= bars_start));
