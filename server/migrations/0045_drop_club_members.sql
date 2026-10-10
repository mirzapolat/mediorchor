-- The Verein section (association member directory) was removed before it
-- ever went live; its table goes with it (its index and any triggers are
-- dropped along with it). Nothing else references it.
drop table if exists club_members;
