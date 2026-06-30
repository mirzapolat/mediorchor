-- ============================================================================
-- Per-user project access.
-- By default a user can access every project (all_projects = true). When set to
-- false, access is limited to the projects explicitly listed in user_projects.
-- The owner always has access to everything.
-- ============================================================================

alter table public.app_users
  add column if not exists all_projects boolean not null default true;

create table if not exists public.user_projects (
  user_id    uuid not null references public.app_users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  primary key (user_id, project_id)
);
create index if not exists user_projects_user_idx on public.user_projects (user_id);

alter table public.user_projects enable row level security;

-- A user may read their own access rows; the owner may read everyone's.
drop policy if exists user_projects_select on public.user_projects;
create policy user_projects_select on public.user_projects
  for select to authenticated using (user_id = auth.uid() or public.is_owner());

-- Only the owner manages who can access what.
drop policy if exists user_projects_write on public.user_projects;
create policy user_projects_write on public.user_projects
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- Helper: may the current user access this project?
create or replace function public.can_access_project(pid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select
    public.is_owner()
    or exists (select 1 from public.app_users where id = auth.uid() and all_projects)
    or exists (
      select 1 from public.user_projects
      where user_id = auth.uid() and project_id = pid
    );
$$;

-- Re-scope project-related access to respect per-user access.
drop policy if exists projects_all on public.projects;

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated using (public.can_access_project(id));

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert to authenticated with check (true);

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update to authenticated using (public.can_access_project(id)) with check (true);

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete to authenticated using (public.can_access_project(id));

drop policy if exists members_all on public.members;
create policy members_all on public.members
  for all to authenticated
  using (public.can_access_project(project_id))
  with check (public.can_access_project(project_id));

drop policy if exists events_all on public.events;
create policy events_all on public.events
  for all to authenticated
  using (public.can_access_project(project_id))
  with check (public.can_access_project(project_id));

drop policy if exists attendance_all on public.attendance;
create policy attendance_all on public.attendance
  for all to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = attendance.event_id and public.can_access_project(e.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = attendance.event_id and public.can_access_project(e.project_id)
    )
  );
