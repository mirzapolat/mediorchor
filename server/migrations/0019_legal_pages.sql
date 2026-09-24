-- Legal pages, linked subtly from the public pages (login, registration
-- forms, check-in): imprint (Impressum) and privacy policy
-- (Datenschutzerklärung). Each one is
--   none = no link
--   text = own text (Markdown), shown at /impressum or /datenschutz
--   link = an external page (*_url, http/https)
alter table app_settings
  add column imprint_mode text not null default 'none' check (imprint_mode in ('none', 'text', 'link'));
alter table app_settings add column imprint_text text not null default '';
alter table app_settings add column imprint_url text;

alter table app_settings
  add column privacy_mode text not null default 'none' check (privacy_mode in ('none', 'text', 'link'));
alter table app_settings add column privacy_text text not null default '';
alter table app_settings add column privacy_url text;
