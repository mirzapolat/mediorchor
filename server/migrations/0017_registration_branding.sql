-- What the public registration form shows above the content:
--   app    = app logo + app name (VITE_APP_NAME), the default
--   custom = app logo + header_text
--   none   = nothing
alter table registration_pages
  add column header_mode text not null default 'app' check (header_mode in ('app', 'custom', 'none'));
alter table registration_pages add column header_text text;
