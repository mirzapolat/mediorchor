-- ---------------------------------------------------------------------------
-- Surveys, the rehearsal weekend and concerts are shown to participants only
-- while the project turns them on (managers always see them). On by default.
-- ---------------------------------------------------------------------------

alter table projects add column show_surveys boolean not null default 1;
alter table projects add column show_weekend boolean not null default 1;
alter table projects add column show_concerts boolean not null default 1;
