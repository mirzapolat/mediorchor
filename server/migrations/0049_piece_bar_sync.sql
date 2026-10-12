-- Sync points that fit a piece's bars to its recordings where they don't
-- follow the notation's timing (fermatas, ritardandi, live recordings):
-- [{ bar, label, at }] — played bar index, its label (to notice a changed
-- timeline) and when that bar starts, in seconds after bar one. Shared by
-- all voices; each voice's lead-in still applies on top.
alter table pieces add column bar_sync json not null default '[]';
