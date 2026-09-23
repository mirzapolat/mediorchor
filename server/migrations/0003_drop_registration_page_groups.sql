-- Per-registration-page group lists were merged into projects.groups by 0002;
-- nothing reads them anymore.
alter table registration_pages drop column groups;
