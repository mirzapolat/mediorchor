-- Rehearsal weekends get their parts published one by one, and nights.
--
-- Publishing: the details (description, dates, sign-up link) and the room
-- allocation are released separately instead of one status for the whole
-- weekend. Rooms are 'hidden', 'open' (participants choose) or 'locked'
-- (seen, but no longer changed). The old status maps onto both.
--
-- Nights: a weekend lasts `days` days (null: from its dates), so it has
-- days - 1 nights. Each participant has the booked period as the import had
-- it (free text, e.g. "Fr–So", "nur Samstag"); `periods` places these labels
-- over the nights: [{ "label": "nur Samstag", "from": 1, "to": 1 }] (night
-- indices from 0, inclusive). A label without a place, or no label, means
-- every night. Two people share a place in a room when their nights don't
-- overlap.
alter table weekends add column details_published boolean not null default 0;
alter table weekends add column rooms_status text not null default 'hidden'
  check (rooms_status in ('hidden', 'open', 'locked'));
alter table weekends add column days integer check (days is null or (days between 1 and 14));
alter table weekends add column periods json not null default '[]';

update weekends set
  details_published = status in ('published', 'closed'),
  rooms_status = case status when 'published' then 'open' when 'closed' then 'locked' else 'hidden' end;

alter table weekends drop column status;

alter table weekend_participants add column booking text;
