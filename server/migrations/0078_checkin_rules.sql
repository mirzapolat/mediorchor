-- Check-in rules of a project (Einstellungen → Check-in).
--
-- checkin_group_change: a guest checks in with their name but another group
-- than the one they are listed under.
--   review     the check-in stays unrecognized and is listed for review
--   overwrite  the person is recognized and their group becomes the new one
--              (only when the name is unique among active members and the
--              group is one of the project's)
--
-- section_lead_checkin: what Stimmeltern may do with unrecognized check-ins.
--   create  assign them to a member or save them as a new member
--   assign  only assign them to an existing member
--   none    only see them
alter table projects add column checkin_group_change text not null default 'review'
  check (checkin_group_change in ('review', 'overwrite'));
alter table projects add column section_lead_checkin text not null default 'create'
  check (section_lead_checkin in ('create', 'assign', 'none'));
