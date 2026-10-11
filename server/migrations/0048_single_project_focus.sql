-- Participants who take part in just one project see only that project (no
-- dashboard or project list). The admin can turn this off.
alter table app_settings add column single_project_focus boolean not null default 1;
