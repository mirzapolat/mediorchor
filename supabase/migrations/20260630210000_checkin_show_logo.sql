-- Whether the project image is rendered in the centre of the check-in QR code.
-- Enabled by default; existing rows keep showing the logo.
alter table public.event_checkins
  add column if not exists show_logo boolean not null default true;
