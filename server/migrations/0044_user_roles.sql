-- Account permissions become one of four roles instead of capability flags
-- and per-project grants:
--   participant  (Teilnehmer)  "Meine Teilnahme" and Stücke of the projects
--                              they take part in; the default for new accounts
--   section_lead (Stimmeltern) the content of every project (members, Proben,
--                              attendance, registrations, …), but no project
--                              settings, archiving or deletion
--   manager      (Verwaltung)  everything except the admin configuration:
--                              projects, the piece collection, Kalender
--   admin                      everything
--
-- Existing accounts get the role that covers what they could do before:
-- admins stay admins; access to all projects, the club, the calendars or the
-- whole piece collection becomes Verwaltung; individual project grants or
-- editing the pieces of one's projects become Stimmeltern (now for every
-- project); everyone else is a Teilnehmer.
alter table app_users add column role text not null default 'participant'
  check (role in ('participant', 'section_lead', 'manager', 'admin'));

update app_users set role = case
  when is_admin then 'admin'
  when can_manage_projects or can_access_club or can_edit_calendars or piece_access = 'all' then 'manager'
  when piece_access = 'projects'
    or exists (select 1 from user_projects up where up.user_id = app_users.id) then 'section_lead'
  else 'participant'
end;

alter table app_users drop column is_admin;
alter table app_users drop column can_manage_projects;
alter table app_users drop column can_access_club;
alter table app_users drop column can_edit_calendars;
alter table app_users drop column piece_access;

drop table user_projects;
