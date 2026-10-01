-- Shown bar numbers can start elsewhere than the notation file says (e.g. an
-- excerpt that begins at bar 37): every numeric bar label is displayed plus
-- this shift. Labels themselves (markers, timeline) stay as they are, so the
-- shift can be changed at any time.
alter table pieces add column bar_shift integer not null default 0;
