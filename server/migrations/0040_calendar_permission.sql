-- Kalender for non-admins: opens and edits the calendars page (off by default;
-- admins always can). Calendar editors see projects and their in-calendar
-- Proben only through the calendar_sources function, not the project tables.
alter table app_users add column can_edit_calendars boolean not null default 0;
