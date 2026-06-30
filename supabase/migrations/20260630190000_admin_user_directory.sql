-- ============================================================================
-- Keep the user directory owner-only while still allowing every user to load
-- their own profile for authentication and account settings.
-- ============================================================================

drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.is_owner())
  );

-- A regular user may update their own display name, but must not be able to
-- promote themselves or change project access through the API. The separate
-- owner update policy remains permissive for administrators.
create or replace function public.is_safe_own_profile_update(
  target_id uuid,
  new_email text,
  new_role text,
  new_all_projects boolean
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    target_id = (select auth.uid())
    and exists (
      select 1
      from public.app_users existing
      where existing.id = target_id
        and existing.email = new_email
        and existing.role = new_role
        and existing.all_projects = new_all_projects
    );
$$;

revoke all on function public.is_safe_own_profile_update(uuid, text, text, boolean) from public;
grant execute on function public.is_safe_own_profile_update(uuid, text, text, boolean) to authenticated;

drop policy if exists app_users_update_self on public.app_users;
create policy app_users_update_self on public.app_users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    public.is_safe_own_profile_update(id, email, role, all_projects)
  );
