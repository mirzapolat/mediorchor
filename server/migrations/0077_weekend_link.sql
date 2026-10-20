-- A rehearsal weekend's room choice can be shared as a link (migration
-- 0076 has the nights). Whoever opens it continues with their account — and
-- is put on the list if they aren't yet — or as a guest with a name and the
-- days they are there; the guest gets a key (kept in their browser, only its
-- hash here) to come back to their place.
alter table weekends add column link_token text;
create unique index weekends_link_token on weekends (link_token) where link_token is not null;

-- Nights chosen on the link (from, to — inclusive, from 0); they win over
-- the imported period.
alter table weekend_participants add column night_from integer check (night_from is null or night_from >= 0);
alter table weekend_participants add column night_to integer check (night_to is null or night_to >= night_from);
alter table weekend_participants add column guest_key_hash text;
create unique index weekend_participants_guest_key on weekend_participants (guest_key_hash) where guest_key_hash is not null;
