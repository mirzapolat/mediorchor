-- ============================================================================
-- User restructure: every account is the same kind of account.
--
-- * Capability flags replace the owner/member role:
--     - is_admin             → full access, may be held by several accounts
--     - can_manage_projects  → project management (scoped via all_projects /
--                              user_projects, unchanged)
--     - can_access_club      → Vereinsmitglieder section (unchanged)
--   A plain account without any flag is a participant: it only sees projects
--   it participates in (via a linked members row).
-- * members.user_id links a project member to an account. Participation =
--   an active, linked member row.
-- * Projects define their groups centrally and carry five access toggles for
--   account/guest check-in and sign-up.
-- * Self-signup (auth trigger) with an app_settings switch to disable it;
--   confirmed emails are linked to pre-existing member rows.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

alter table public.app_users
  add column if not exists is_admin boolean not null default false,
  add column if not exists can_manage_projects boolean not null default false;

-- Existing owners become admins; existing members were managers all along
-- (they had full project access), so they keep management rights.
update public.app_users set is_admin = true where role = 'owner';
update public.app_users
  set can_manage_projects = true
  where role <> 'owner' and can_access_projects;

alter table public.members
  add column if not exists user_id uuid references public.app_users (id) on delete set null;
create index if not exists members_user_idx on public.members (user_id);
-- One linked member row per project and account.
create unique index if not exists members_project_user_uidx
  on public.members (project_id, user_id) where user_id is not null;

alter table public.projects
  add column if not exists groups text[] not null default '{}',
  add column if not exists allow_account_access boolean not null default true,
  add column if not exists allow_account_checkin boolean not null default true,
  add column if not exists allow_account_signup boolean not null default true,
  add column if not exists allow_guest_checkin boolean not null default true,
  add column if not exists allow_guest_signup boolean not null default true;

-- Seed the central group list from what is already in use: member groups plus
-- the per-page group lists of existing registration pages.
update public.projects p
set groups = sub.gs
from (
  select project_id, array_agg(distinct g order by g) as gs
  from (
    select m.project_id, btrim(m.group_name) as g
    from public.members m
    where m.group_name is not null and btrim(m.group_name) <> ''
    union
    select rp.project_id, btrim(u.g)
    from public.registration_pages rp, unnest(rp.groups) as u(g)
    where btrim(u.g) <> ''
  ) all_groups
  group by project_id
) sub
where sub.project_id = p.id
  and p.groups = '{}';

alter table public.app_settings
  add column if not exists allow_self_signup boolean not null default true;

-- ---------------------------------------------------------------------------
-- 2. Helper functions (redefined on top of the new flags)
-- ---------------------------------------------------------------------------

-- Historic name kept so every existing policy stays valid: "owner" now means
-- "any admin account".
create or replace function public.is_owner()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_users
    where id = auth.uid() and is_admin
  );
$$;

-- Management access to a project (writes, settings, member lists, …).
create or replace function public.can_access_project(pid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select
    public.is_owner()
    or (
      exists (select 1 from public.app_users where id = auth.uid() and can_manage_projects)
      and (
        exists (select 1 from public.app_users where id = auth.uid() and all_projects)
        or exists (
          select 1 from public.user_projects
          where user_id = auth.uid() and project_id = pid
        )
      )
    );
$$;

-- Participant access: an active linked member row in a project that allows
-- account access.
create or replace function public.is_project_participant(pid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.members m
    join public.projects p on p.id = m.project_id
    where m.project_id = pid
      and m.user_id = auth.uid()
      and m.status = 'active'
      and p.allow_account_access
  );
$$;

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

-- ---------------------------------------------------------------------------
-- 3. Own-profile update guard, then drop the legacy columns
-- ---------------------------------------------------------------------------

drop policy if exists app_users_update_self on public.app_users;
drop function if exists public.is_safe_own_profile_update(uuid, text, text, boolean);

-- A user may edit their own display name but none of the permission fields.
create or replace function public.is_safe_own_profile_update(
  target_id uuid,
  new_email text,
  new_is_admin boolean,
  new_can_manage_projects boolean,
  new_can_access_club boolean,
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
        and existing.is_admin = new_is_admin
        and existing.can_manage_projects = new_can_manage_projects
        and existing.can_access_club = new_can_access_club
        and existing.all_projects = new_all_projects
    );
$$;

revoke all on function public.is_safe_own_profile_update(uuid, text, boolean, boolean, boolean, boolean) from public;
grant execute on function public.is_safe_own_profile_update(uuid, text, boolean, boolean, boolean, boolean) to authenticated;

create policy app_users_update_self on public.app_users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    public.is_safe_own_profile_update(
      id, email, is_admin, can_manage_projects, can_access_club, all_projects
    )
  );

alter table public.app_users drop column if exists role;
alter table public.app_users drop column if exists can_access_projects;

-- ---------------------------------------------------------------------------
-- 4. RLS: restrict project creation, open participant reads
-- ---------------------------------------------------------------------------

-- Only admins and project managers create projects (was: any authenticated).
drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert to authenticated
  with check (
    public.is_owner()
    or exists (
      select 1 from public.app_users
      where id = auth.uid() and can_manage_projects
    )
  );

-- Participants may read the projects they belong to.
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using (public.can_access_project(id) or public.is_project_participant(id));

-- Participants always see their own member row (their group etc.), including
-- after leaving (needed to re-join and to render their history).
drop policy if exists members_select_own on public.members;
create policy members_select_own on public.members
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Participants see the events of their projects (upcoming Proben + history).
drop policy if exists events_select_participant on public.events;
create policy events_select_participant on public.events
  for select to authenticated
  using (public.is_project_participant(project_id));

-- Participants see their own attendance rows.
drop policy if exists attendance_select_own on public.attendance;
create policy attendance_select_own on public.attendance
  for select to authenticated
  using (
    exists (
      select 1 from public.members m
      where m.id = attendance.member_id and m.user_id = (select auth.uid())
    )
  );

-- Participants get read access to pieces and their content blocks.
drop policy if exists pieces_select_participant on public.pieces;
create policy pieces_select_participant on public.pieces
  for select to authenticated
  using (public.is_project_participant(project_id));

drop policy if exists piece_blocks_select_participant on public.piece_blocks;
create policy piece_blocks_select_participant on public.piece_blocks
  for select to authenticated
  using (
    exists (
      select 1 from public.pieces p
      where p.id = piece_blocks.piece_id
        and public.is_project_participant(p.project_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Self-signup: auth trigger + public config
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.app_users (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- The login page (anon) needs to know whether self-signup is allowed.
create or replace function public.get_public_config()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select jsonb_build_object(
    'allow_self_signup', coalesce((select allow_self_signup from public.app_settings where id = 1), true)
  );
$$;

revoke all on function public.get_public_config() from public;
grant execute on function public.get_public_config() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Linking accounts to existing member rows (confirmed emails only)
-- ---------------------------------------------------------------------------

-- Attaches unlinked member rows whose email matches the caller's verified
-- email. Guest check-ins / registrations that were transferred to members in
-- the past carry that email, so past attendance connects automatically.
-- Called by the app after every login; cheap and idempotent.
create or replace function public.claim_my_memberships()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
begin
  select au.email into v_email
  from auth.users au
  where au.id = auth.uid() and au.email_confirmed_at is not null;

  if v_email is null then
    return;
  end if;

  update public.members m
  set user_id = auth.uid()
  where m.user_id is null
    and lower(btrim(coalesce(m.email, ''))) = lower(v_email)
    -- oldest matching row per project wins …
    and m.id = (
      select m2.id from public.members m2
      where m2.project_id = m.project_id
        and m2.user_id is null
        and lower(btrim(coalesce(m2.email, ''))) = lower(v_email)
      order by m2.created_at
      limit 1
    )
    -- … and never create a second link in the same project.
    and not exists (
      select 1 from public.members m3
      where m3.project_id = m.project_id and m3.user_id = auth.uid()
    );
end;
$$;

revoke all on function public.claim_my_memberships() from public;
grant execute on function public.claim_my_memberships() to authenticated;

-- Link rows for accounts that already exist and are confirmed.
update public.members m
set user_id = sub.uid
from (
  select distinct on (m2.project_id, lower(btrim(m2.email)))
         m2.id as member_id, u.id as uid
  from public.members m2
  join public.app_users u on lower(btrim(m2.email)) = lower(u.email)
  join auth.users au on au.id = u.id and au.email_confirmed_at is not null
  where m2.user_id is null and coalesce(btrim(m2.email), '') <> ''
  order by m2.project_id, lower(btrim(m2.email)), m2.created_at
) sub
where m.id = sub.member_id
  and not exists (
    select 1 from public.members m3
    where m3.project_id = m.project_id and m3.user_id = sub.uid
  );

-- ---------------------------------------------------------------------------
-- 7. Participation RPCs (join / leave / change group)
-- ---------------------------------------------------------------------------

-- Join a project. Managers/admins may join any project; a plain account may
-- only re-activate an existing link (new participants arrive via check-in,
-- sign-up or a manager adding them).
create or replace function public.join_project(
  p_project_id uuid,
  p_first_name text,
  p_last_name text,
  p_group_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project record;
  v_member public.members%rowtype;
  v_email text;
  v_first_name text := btrim(coalesce(p_first_name, ''));
  v_last_name text := btrim(coalesce(p_last_name, ''));
  v_group_name text := nullif(btrim(coalesce(p_group_name, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_project from public.projects where id = p_project_id;
  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;

  select * into v_member
  from public.members
  where project_id = p_project_id and user_id = auth.uid();

  if not found and not public.can_access_project(p_project_id) then
    raise exception 'Project access denied' using errcode = '42501';
  end if;

  if v_group_name is not null
     and array_length(v_project.groups, 1) is not null
     and not (v_group_name = any (v_project.groups)) then
    return jsonb_build_object('state', 'invalid_group');
  end if;

  if v_member.id is not null then
    update public.members
    set status = 'active',
        group_name = coalesce(v_group_name, group_name)
    where id = v_member.id;
    return jsonb_build_object('state', 'success', 'member_id', v_member.id);
  end if;

  if v_first_name = '' or v_last_name = ''
     or length(v_first_name) > 120 or length(v_last_name) > 120 then
    return jsonb_build_object('state', 'invalid_input');
  end if;

  select au.email into v_email from auth.users au where au.id = auth.uid();

  insert into public.members (project_id, first_name, last_name, group_name, email, status, user_id)
  values (p_project_id, v_first_name, v_last_name, v_group_name, v_email, 'active', auth.uid())
  returning * into v_member;

  return jsonb_build_object('state', 'success', 'member_id', v_member.id);
end;
$$;

-- Leave a project: the member row is kept (history stays intact for
-- statistics) but archived, which ends participant access.
create or replace function public.leave_project(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  update public.members
  set status = 'archived'
  where project_id = p_project_id and user_id = auth.uid() and status <> 'archived';

  if not found then
    return jsonb_build_object('state', 'not_participating');
  end if;
  return jsonb_build_object('state', 'success');
end;
$$;

-- Change the own group within a project; only centrally defined groups are
-- selectable.
create or replace function public.set_my_group(p_project_id uuid, p_group_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_groups text[];
  v_group_name text := nullif(btrim(coalesce(p_group_name, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select groups into v_groups from public.projects where id = p_project_id;
  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;

  if v_group_name is not null
     and array_length(v_groups, 1) is not null
     and not (v_group_name = any (v_groups)) then
    return jsonb_build_object('state', 'invalid_group');
  end if;

  update public.members
  set group_name = v_group_name
  where project_id = p_project_id and user_id = auth.uid() and status = 'active';

  if not found then
    return jsonb_build_object('state', 'not_participating');
  end if;
  return jsonb_build_object('state', 'success');
end;
$$;

revoke all on function public.join_project(uuid, text, text, text) from public;
revoke all on function public.leave_project(uuid) from public;
revoke all on function public.set_my_group(uuid, text) from public;
grant execute on function public.join_project(uuid, text, text, text) to authenticated;
grant execute on function public.leave_project(uuid) to authenticated;
grant execute on function public.set_my_group(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Public check-in: project groups, guest toggle, account check-in
-- ---------------------------------------------------------------------------

create or replace function public.get_public_checkin(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_checkin record;
  v_groups jsonb;
  v_me jsonb := null;
  v_member record;
begin
  select c.event_id, c.is_active, e.name as event_name,
         e.project_id, p.name as project_name, p.groups as project_groups,
         p.allow_guest_checkin, p.allow_account_checkin
    into v_checkin
  from public.event_checkins c
  join public.events e on e.id = c.event_id
  join public.projects p on p.id = e.project_id
  where c.token::text = p_token;

  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;

  if not v_checkin.is_active then
    return jsonb_build_object(
      'state', 'stopped',
      'event_name', v_checkin.event_name,
      'project_name', v_checkin.project_name
    );
  end if;

  -- Central project groups; fall back to the groups already in use by members
  -- for projects that have not maintained the list yet.
  if array_length(v_checkin.project_groups, 1) is not null then
    select to_jsonb(v_checkin.project_groups) into v_groups;
  else
    select coalesce(jsonb_agg(g.group_name order by g.group_name), '[]'::jsonb)
      into v_groups
    from (
      select distinct m.group_name
      from public.members m
      where m.project_id = v_checkin.project_id
        and m.status = 'active'
        and m.group_name is not null
        and btrim(m.group_name) <> ''
    ) g;
  end if;

  -- Logged-in visitors get their linked member for a one-tap check-in.
  if auth.uid() is not null then
    select m.first_name, m.last_name, m.group_name, m.status
      into v_member
    from public.members m
    where m.project_id = v_checkin.project_id and m.user_id = auth.uid();
    if found then
      v_me := jsonb_build_object(
        'first_name', v_member.first_name,
        'last_name', v_member.last_name,
        'group_name', v_member.group_name,
        'participating', v_member.status = 'active'
      );
    end if;
  end if;

  return jsonb_build_object(
    'state', 'active',
    'event_name', v_checkin.event_name,
    'project_name', v_checkin.project_name,
    'groups', v_groups,
    'allow_guest_checkin', v_checkin.allow_guest_checkin,
    'allow_account_checkin', v_checkin.allow_account_checkin,
    'logged_in', auth.uid() is not null,
    'me', v_me
  );
end;
$$;

-- Signature changes (new defaulted parameter), so drop the old function to
-- avoid an ambiguous overload for PostgREST.
drop function if exists public.submit_public_checkin(text, text, text, text);

create or replace function public.submit_public_checkin(
  p_token text,
  p_first_name text,
  p_last_name text,
  p_group_name text,
  p_as_account boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_checkin record;
  v_member_id uuid;
  v_member_status text;
  v_email text;
  v_first_name text := btrim(p_first_name);
  v_last_name text := btrim(p_last_name);
  v_group_name text := btrim(p_group_name);
begin
  select c.event_id, c.is_active, c.attendance_status, e.project_id,
         p.allow_guest_checkin, p.allow_account_checkin
    into v_checkin
  from public.event_checkins c
  join public.events e on e.id = c.event_id
  join public.projects p on p.id = e.project_id
  where c.token::text = p_token;

  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;

  if not v_checkin.is_active then
    return jsonb_build_object('state', 'stopped');
  end if;

  -- Account check-in: use (or create) the caller's linked member row.
  if p_as_account and auth.uid() is not null then
    if not v_checkin.allow_account_checkin then
      return jsonb_build_object('state', 'not_allowed');
    end if;

    select m.id, m.status into v_member_id, v_member_status
    from public.members m
    where m.project_id = v_checkin.project_id and m.user_id = auth.uid();

    if v_member_id is null then
      -- First contact with this project: joining happens implicitly.
      if v_first_name = '' or v_last_name = ''
         or length(v_first_name) > 120 or length(v_last_name) > 120
         or length(v_group_name) > 120 then
        return jsonb_build_object('state', 'invalid_input');
      end if;
      select au.email into v_email from auth.users au where au.id = auth.uid();
      insert into public.members (project_id, first_name, last_name, group_name, email, status, user_id)
      values (v_checkin.project_id, v_first_name, v_last_name,
              nullif(v_group_name, ''), v_email, 'active', auth.uid())
      returning id into v_member_id;
    elsif v_member_status <> 'active' then
      update public.members set status = 'active' where id = v_member_id;
    end if;

    insert into public.attendance (event_id, member_id, status, is_guest)
    values (v_checkin.event_id, v_member_id, v_checkin.attendance_status, false)
    on conflict (event_id, member_id)
    do update set status = excluded.status, is_guest = false;

    insert into public.checkin_submissions (
      event_id, member_id, first_name, last_name, group_name,
      recognized, attendance_status
    )
    select v_checkin.event_id, m.id, m.first_name, m.last_name,
           coalesce(m.group_name, ''), true, v_checkin.attendance_status
    from public.members m where m.id = v_member_id;

    return jsonb_build_object('state', 'success', 'recognized', true);
  end if;

  -- Guest check-in.
  if not v_checkin.allow_guest_checkin then
    return jsonb_build_object('state', 'not_allowed');
  end if;

  if v_first_name = '' or v_last_name = '' or v_group_name = ''
     or length(v_first_name) > 120 or length(v_last_name) > 120
     or length(v_group_name) > 120 then
    return jsonb_build_object('state', 'invalid_input');
  end if;

  select m.id into v_member_id
  from public.members m
  where m.project_id = v_checkin.project_id
    and m.status = 'active'
    and lower(btrim(m.first_name)) = lower(v_first_name)
    and lower(btrim(m.last_name)) = lower(v_last_name)
    and m.group_name = v_group_name
  order by m.created_at
  limit 1;

  if v_member_id is not null then
    insert into public.attendance (event_id, member_id, status, is_guest)
    values (v_checkin.event_id, v_member_id, v_checkin.attendance_status, false)
    on conflict (event_id, member_id)
    do update set status = excluded.status, is_guest = false;

    insert into public.checkin_submissions (
      event_id, member_id, first_name, last_name, group_name,
      recognized, attendance_status
    ) values (
      v_checkin.event_id, v_member_id, v_first_name, v_last_name, v_group_name,
      true, v_checkin.attendance_status
    );

    return jsonb_build_object('state', 'success', 'recognized', true);
  end if;

  insert into public.checkin_submissions (
    event_id, first_name, last_name, group_name, recognized
  ) values (
    v_checkin.event_id, v_first_name, v_last_name, v_group_name, false
  );

  return jsonb_build_object('state', 'success', 'recognized', false);
end;
$$;

revoke all on function public.submit_public_checkin(text, text, text, text, boolean) from public;
grant execute on function public.submit_public_checkin(text, text, text, text, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Public registration: project groups, guest toggle, account sign-up
-- ---------------------------------------------------------------------------

create or replace function public.get_public_registration(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_page record;
  v_groups jsonb;
  v_me jsonb := null;
  v_user record;
begin
  select rp.id, rp.is_active, rp.title, rp.description, rp.ask_email,
         rp.ask_group, rp.groups, rp.project_id, p.name as project_name,
         p.groups as project_groups,
         p.allow_guest_signup, p.allow_account_signup
    into v_page
  from public.registration_pages rp
  join public.projects p on p.id = rp.project_id
  where rp.token::text = p_token;

  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;

  if not v_page.is_active then
    return jsonb_build_object(
      'state', 'inactive',
      'title', v_page.title,
      'project_name', v_page.project_name
    );
  end if;

  -- Groups come from the project now; legacy per-page lists act as fallback.
  if array_length(v_page.project_groups, 1) is not null then
    select to_jsonb(v_page.project_groups) into v_groups;
  else
    select to_jsonb(v_page.groups) into v_groups;
  end if;

  if auth.uid() is not null then
    select u.name, au.email, exists (
             select 1 from public.members m
             where m.project_id = v_page.project_id
               and m.user_id = u.id and m.status = 'active'
           ) as participating
      into v_user
    from public.app_users u
    join auth.users au on au.id = u.id
    where u.id = auth.uid();
    if found then
      v_me := jsonb_build_object(
        'name', v_user.name,
        'email', v_user.email,
        'participating', v_user.participating
      );
    end if;
  end if;

  return jsonb_build_object(
    'state', 'active',
    'title', v_page.title,
    'description', v_page.description,
    'ask_email', v_page.ask_email,
    'ask_group', v_page.ask_group,
    'groups', v_groups,
    'project_name', v_page.project_name,
    'allow_guest_signup', v_page.allow_guest_signup,
    'allow_account_signup', v_page.allow_account_signup,
    'logged_in', auth.uid() is not null,
    'me', v_me
  );
end;
$$;

drop function if exists public.submit_public_registration(text, text, text, text, text);

create or replace function public.submit_public_registration(
  p_token text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_group_name text,
  p_as_account boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_page record;
  v_first_name text := btrim(p_first_name);
  v_last_name text := btrim(p_last_name);
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_group_name text := nullif(btrim(coalesce(p_group_name, '')), '');
  v_as_account boolean := p_as_account and auth.uid() is not null;
  v_member_id uuid := null;
begin
  if v_first_name = '' or v_last_name = ''
     or length(v_first_name) > 120 or length(v_last_name) > 120
     or length(coalesce(v_email, '')) > 200
     or length(coalesce(v_group_name, '')) > 120 then
    return jsonb_build_object('state', 'invalid_input');
  end if;

  select rp.id, rp.project_id, rp.is_active, rp.ask_email, rp.ask_group,
         rp.auto_transfer, p.allow_guest_signup, p.allow_account_signup
    into v_page
  from public.registration_pages rp
  join public.projects p on p.id = rp.project_id
  where rp.token::text = p_token;

  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;

  if not v_page.is_active then
    return jsonb_build_object('state', 'inactive');
  end if;

  if v_as_account and not v_page.allow_account_signup then
    return jsonb_build_object('state', 'not_allowed');
  end if;
  if not v_as_account and not v_page.allow_guest_signup then
    return jsonb_build_object('state', 'not_allowed');
  end if;

  if v_as_account then
    -- The account's verified address always wins over a typed one.
    select au.email into v_email from auth.users au where au.id = auth.uid();
  elsif not v_page.ask_email then
    v_email := null;
  end if;
  if not v_page.ask_group then
    v_group_name := null;
  end if;

  if v_as_account then
    -- Signing up with an account makes (or re-activates) the participant link
    -- regardless of auto_transfer: the person explicitly joined.
    select m.id into v_member_id
    from public.members m
    where m.project_id = v_page.project_id and m.user_id = auth.uid();

    if v_member_id is not null then
      update public.members
      set status = 'active', group_name = coalesce(v_group_name, group_name)
      where id = v_member_id;
    else
      insert into public.members (project_id, first_name, last_name, group_name, email, status, user_id)
      values (v_page.project_id, v_first_name, v_last_name, v_group_name, v_email, 'active', auth.uid())
      returning id into v_member_id;
    end if;
  elsif v_page.auto_transfer then
    insert into public.members (project_id, first_name, last_name, group_name, email, status)
    values (v_page.project_id, v_first_name, v_last_name, v_group_name, v_email, 'active')
    returning id into v_member_id;
  end if;

  insert into public.registrations (
    registration_page_id, first_name, last_name, email, group_name,
    member_id, transferred
  ) values (
    v_page.id, v_first_name, v_last_name, v_email, v_group_name,
    v_member_id, v_member_id is not null
  );

  return jsonb_build_object('state', 'success');
end;
$$;

revoke all on function public.submit_public_registration(text, text, text, text, text, boolean) from public;
grant execute on function public.submit_public_registration(text, text, text, text, text, boolean) to anon, authenticated;
