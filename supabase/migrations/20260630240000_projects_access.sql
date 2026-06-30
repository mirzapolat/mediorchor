-- ============================================================================
-- Per-user access to the projects section.
-- A user can be denied the projects page entirely (default: allowed). This is
-- folded into can_access_project() so it is enforced for every project-scoped
-- table (projects, members, events, attendance, …) as well as in the UI.
-- ============================================================================

alter table public.app_users
  add column if not exists can_access_projects boolean not null default true;

create or replace function public.can_access_project(pid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select
    public.is_owner()
    or (
      exists (select 1 from public.app_users where id = auth.uid() and can_access_projects)
      and (
        exists (select 1 from public.app_users where id = auth.uid() and all_projects)
        or exists (
          select 1 from public.user_projects
          where user_id = auth.uid() and project_id = pid
        )
      )
    );
$$;
