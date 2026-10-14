-- Master switch for outgoing email (Admin → Email). Off = the app behaves as
-- if no mail server were configured: sign-ups and email changes apply right
-- away, no notifications, no email codes. The SMTP settings are kept.
alter table app_settings add column email_enabled boolean not null default 1;
