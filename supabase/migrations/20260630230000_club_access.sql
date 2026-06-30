-- ============================================================================
-- Per-user access to the club members section.
-- This reconciles environments where 20260630220000 was applied before it
-- carried the access changes; all statements are idempotent.
-- ============================================================================

alter table public.app_users
  add column if not exists can_access_club boolean not null default false;

create or replace function public.can_access_club()
returns boolean
language sql
security definer
set search_path = public
as $$
  select
    public.is_owner()
    or exists (
      select 1 from public.app_users
      where id = auth.uid() and can_access_club
    );
$$;

-- Restrict the club directory to users that hold the permission (or the owner).
drop policy if exists club_members_authenticated on public.club_members;
create policy club_members_authenticated on public.club_members
  for all to authenticated
  using (public.can_access_club())
  with check (public.can_access_club());
