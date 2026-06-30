-- New event check-ins stay unavailable until an administrator starts them.
-- Existing rows intentionally keep their current active/stopped state.
alter table public.event_checkins
  alter column is_active set default false;
