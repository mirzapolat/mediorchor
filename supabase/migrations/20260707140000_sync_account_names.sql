-- ============================================================================
-- Keep member names in sync with the account name.
--
-- When an account changes its display name, every linked member row (all
-- projects) is renamed along with it. Managers can still rename a member
-- inside a project afterwards; the UI then shows that the name deviates from
-- the account (via linked_account_names below).
-- ============================================================================

create or replace function public.sync_member_names_from_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := btrim(coalesce(new.name, ''));
  v_space int;
  v_first text;
  v_last text;
begin
  if v_name = '' or new.name is not distinct from old.name then
    return new;
  end if;

  -- Split at the last space (same heuristic the app uses everywhere).
  v_space := length(v_name) - position(' ' in reverse(v_name)) + 1;
  if position(' ' in v_name) = 0 then
    v_first := v_name;
    v_last := '';
  else
    v_first := btrim(left(v_name, v_space - 1));
    v_last := btrim(substring(v_name from v_space + 1));
  end if;

  update public.members
  set first_name = v_first, last_name = v_last
  where user_id = new.id;

  return new;
end;
$$;

drop trigger if exists on_app_user_name_change on public.app_users;
create trigger on_app_user_name_change
  after update of name on public.app_users
  for each row execute function public.sync_member_names_from_account();

-- Managers may see the account names behind linked members of their project,
-- so the UI can flag member names that deviate from the account.
create or replace function public.linked_account_names(p_project_id uuid)
returns table (member_id uuid, account_name text)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select m.id, u.name
  from public.members m
  join public.app_users u on u.id = m.user_id
  where m.project_id = p_project_id
    and public.can_access_project(p_project_id);
$$;

revoke all on function public.linked_account_names(uuid) from public;
grant execute on function public.linked_account_names(uuid) to authenticated;
