-- ============================================================================
-- Participation refinements (follow-up to 20260707120000_user_restructure):
--
-- * Account sign-ups no longer join a project immediately: like guest
--   registrations they must be transferred (unless auto-transfer is on).
--   registrations.user_id remembers the account; the transfer links it.
-- * Absence labels: saved condition presets per project, orderable, public
--   labels are shown to matching participants on "Meine Teilnahme".
-- * projects.allow_participant_pieces: whether participants see the Stücke
--   page (default on).
-- * search_accounts(): managers can look up accounts to add them as members.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Registration ≠ membership: transfer creates/links the member
-- ---------------------------------------------------------------------------

-- Account sign-ups remember the account, but membership only happens when the
-- registration is transferred (automatically or by a manager) — exactly like
-- guest registrations.
alter table public.registrations
  add column if not exists user_id uuid references public.app_users (id) on delete set null;

-- Turns a registration into a project member. When the registration belongs
-- to an account that already has a member row in the project, that row is
-- re-activated instead of inserting a duplicate (one link per project).
create or replace function public.registration_to_member(
  p_project_id uuid,
  p_first_name text,
  p_last_name text,
  p_group_name text,
  p_email text,
  p_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member_id uuid;
begin
  if p_user_id is not null then
    select id into v_member_id
    from public.members
    where project_id = p_project_id and user_id = p_user_id;

    if v_member_id is not null then
      update public.members
      set status = 'active', group_name = coalesce(p_group_name, group_name)
      where id = v_member_id;
      return v_member_id;
    end if;
  end if;

  insert into public.members (project_id, first_name, last_name, group_name, email, status, user_id)
  values (p_project_id, p_first_name, p_last_name, p_group_name, p_email, 'active', p_user_id)
  returning id into v_member_id;
  return v_member_id;
end;
$$;

-- Internal helper: only reachable through the security-definer functions below.
revoke all on function public.registration_to_member(uuid, text, text, text, text, uuid) from public;

-- Same signature as in the previous migration, new body: no immediate
-- membership for account sign-ups anymore.
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

  -- Membership only happens through the transfer, never at submission time.
  if v_page.auto_transfer then
    v_member_id := public.registration_to_member(
      v_page.project_id, v_first_name, v_last_name, v_group_name, v_email,
      case when v_as_account then auth.uid() end
    );
  end if;

  insert into public.registrations (
    registration_page_id, first_name, last_name, email, group_name,
    member_id, transferred, user_id
  ) values (
    v_page.id, v_first_name, v_last_name, v_email, v_group_name,
    v_member_id, v_member_id is not null,
    case when v_as_account then auth.uid() end
  );

  return jsonb_build_object('state', 'success');
end;
$$;

-- Transfer functions: same behavior as before, but account registrations link
-- the created (or re-activated) member to the account.
create or replace function public.transfer_registration(p_registration_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reg record;
  v_member_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select r.id, r.first_name, r.last_name, r.email, r.group_name, r.transferred,
         r.user_id, rp.project_id
    into v_reg
  from public.registrations r
  join public.registration_pages rp on rp.id = r.registration_page_id
  where r.id = p_registration_id;

  if not found then
    raise exception 'Registration not found';
  end if;

  if not public.can_access_project(v_reg.project_id) then
    raise exception 'Project access denied' using errcode = '42501';
  end if;

  if v_reg.transferred then
    return jsonb_build_object('success', true, 'transferred', 0);
  end if;

  v_member_id := public.registration_to_member(
    v_reg.project_id, v_reg.first_name, v_reg.last_name, v_reg.group_name,
    v_reg.email, v_reg.user_id
  );

  update public.registrations
  set transferred = true, member_id = v_member_id
  where id = p_registration_id;

  return jsonb_build_object('success', true, 'transferred', 1);
end;
$$;

create or replace function public.transfer_all_registrations(p_page_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_reg record;
  v_member_id uuid;
  v_count int := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select project_id into v_project_id
  from public.registration_pages
  where id = p_page_id;

  if not found then
    raise exception 'Registration page not found';
  end if;

  if not public.can_access_project(v_project_id) then
    raise exception 'Project access denied' using errcode = '42501';
  end if;

  for v_reg in
    select id, first_name, last_name, email, group_name, user_id
    from public.registrations
    where registration_page_id = p_page_id and not transferred
    order by created_at
  loop
    v_member_id := public.registration_to_member(
      v_project_id, v_reg.first_name, v_reg.last_name, v_reg.group_name,
      v_reg.email, v_reg.user_id
    );

    update public.registrations
    set transferred = true, member_id = v_member_id
    where id = v_reg.id;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('success', true, 'transferred', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Stücke page for participants: per-project toggle
-- ---------------------------------------------------------------------------

alter table public.projects
  add column if not exists allow_participant_pieces boolean not null default true;

-- Participants get read access to pieces and their content blocks, unless the
-- project turned the Stücke page off for participants.
create or replace function public.participant_can_see_pieces(pid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_project_participant(pid)
    and exists (
      select 1 from public.projects p
      where p.id = pid and p.allow_participant_pieces
    );
$$;

drop policy if exists pieces_select_participant on public.pieces;
create policy pieces_select_participant on public.pieces
  for select to authenticated
  using (public.participant_can_see_pieces(project_id));

drop policy if exists piece_blocks_select_participant on public.piece_blocks;
create policy piece_blocks_select_participant on public.piece_blocks
  for select to authenticated
  using (
    exists (
      select 1 from public.pieces p
      where p.id = piece_blocks.piece_id
        and public.participant_can_see_pieces(p.project_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Account search for the member form
-- ---------------------------------------------------------------------------

-- Project managers may look up existing accounts by name/email to add them to
-- a project.
create or replace function public.search_accounts(p_query text)
returns table (id uuid, name text, email text)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
begin
  if not (
    public.is_owner()
    or exists (
      select 1 from public.app_users
      where app_users.id = auth.uid() and can_manage_projects
    )
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  return query
  select u.id, u.name, u.email
  from public.app_users u
  where btrim(coalesce(p_query, '')) <> ''
    and (
      u.name ilike '%' || btrim(p_query) || '%'
      or u.email ilike '%' || btrim(p_query) || '%'
    )
  order by u.name, u.email
  limit 10;
end;
$$;

revoke all on function public.search_accounts(text) from public;
grant execute on function public.search_accounts(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Absence labels: saved condition presets per project
-- ---------------------------------------------------------------------------

-- A label stores an ordered set of absence conditions (jsonb array of
-- {connector, metric, comparison, value}). Public labels are also shown to
-- matching participants on their "Meine Teilnahme" page.
create table if not exists public.absence_labels (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name       text not null,
  conditions jsonb not null default '[]',
  is_public  boolean not null default false,
  position   int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists absence_labels_project_idx
  on public.absence_labels (project_id, position);

alter table public.absence_labels enable row level security;

drop policy if exists absence_labels_manage on public.absence_labels;
create policy absence_labels_manage on public.absence_labels
  for all to authenticated
  using (public.can_access_project(project_id))
  with check (public.can_access_project(project_id));

drop policy if exists absence_labels_select_participant on public.absence_labels;
create policy absence_labels_select_participant on public.absence_labels
  for select to authenticated
  using (is_public and public.is_project_participant(project_id));
