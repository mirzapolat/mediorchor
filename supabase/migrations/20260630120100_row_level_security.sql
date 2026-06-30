-- ============================================================================
-- Row Level Security.
-- Every authenticated user has access to all projects/members/events. Only the
-- owner can manage users and settings.
-- ============================================================================

alter table public.app_users    enable row level security;
alter table public.app_settings enable row level security;
alter table public.projects     enable row level security;
alter table public.members      enable row level security;
alter table public.events       enable row level security;
alter table public.attendance   enable row level security;

-- app_users: everyone authenticated may read; users may update their own name;
-- the owner may update any row (used for transferring ownership).
drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users
  for select to authenticated using (true);

drop policy if exists app_users_update_self on public.app_users;
create policy app_users_update_self on public.app_users
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists app_users_update_owner on public.app_users;
create policy app_users_update_owner on public.app_users
  for update to authenticated using (public.is_owner()) with check (public.is_owner());

-- app_settings: everyone reads, owner writes.
drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select to authenticated using (true);

drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- projects / members / events / attendance: any authenticated user, full access.
drop policy if exists projects_all on public.projects;
create policy projects_all on public.projects
  for all to authenticated using (true) with check (true);

drop policy if exists members_all on public.members;
create policy members_all on public.members
  for all to authenticated using (true) with check (true);

drop policy if exists events_all on public.events;
create policy events_all on public.events
  for all to authenticated using (true) with check (true);

drop policy if exists attendance_all on public.attendance;
create policy attendance_all on public.attendance
  for all to authenticated using (true) with check (true);
