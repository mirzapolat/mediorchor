-- ============================================================================
-- Score PDF + bar anchors for audio blocks.
-- An audio block with bars can carry a score PDF. Bars can be anchored onto
-- the PDF (page + fractional x/y position) so the practice page shows the
-- clickable bar buttons directly on the sheet music.
-- ============================================================================

alter table public.piece_blocks
  add column if not exists score_path text,
  add column if not exists score_name text,
  add column if not exists bar_anchors jsonb not null default '{}'::jsonb;
