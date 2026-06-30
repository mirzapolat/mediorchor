-- ============================================================================
-- Public registration pages.
-- A project can publish self-service registration pages. Anonymous visitors
-- open a public link and walk through a four-step sign-up flow; their data is
-- stored as registrations that an administrator can transfer into the member
-- directory (manually or automatically).
-- ============================================================================

create table if not exists public.registration_pages (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  token         uuid not null default gen_random_uuid() unique,
  title         text not null,
  description   text not null default '',
  ask_email     boolean not null default true,
  ask_group     boolean not null default true,
  groups        text[] not null default '{}',
  is_active     boolean not null default false,
  auto_transfer boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists registration_pages_project_idx
  on public.registration_pages (project_id);

create table if not exists public.registrations (
  id                   uuid primary key default gen_random_uuid(),
  registration_page_id uuid not null references public.registration_pages (id) on delete cascade,
  first_name           text not null,
  last_name            text not null,
  email                text,
  group_name           text,
  member_id            uuid references public.members (id) on delete set null,
  transferred          boolean not null default false,
  created_at           timestamptz not null default now()
);
create index if not exists registrations_page_idx
  on public.registrations (registration_page_id, created_at desc);

alter table public.registration_pages enable row level security;
alter table public.registrations enable row level security;

-- Administrators with access to the owning project manage the pages.
drop policy if exists registration_pages_authenticated on public.registration_pages;
create policy registration_pages_authenticated on public.registration_pages
  for all to authenticated
  using (public.can_access_project(project_id))
  with check (public.can_access_project(project_id));

drop policy if exists registrations_authenticated on public.registrations;
create policy registrations_authenticated on public.registrations
  for all to authenticated
  using (
    exists (
      select 1 from public.registration_pages rp
      where rp.id = registrations.registration_page_id
        and public.can_access_project(rp.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.registration_pages rp
      where rp.id = registrations.registration_page_id
        and public.can_access_project(rp.project_id)
    )
  );

-- Returns only what is needed to render the public form.
create or replace function public.get_public_registration(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_page record;
begin
  select rp.id, rp.is_active, rp.title, rp.description, rp.ask_email,
         rp.ask_group, rp.groups, p.name as project_name
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

  return jsonb_build_object(
    'state', 'active',
    'title', v_page.title,
    'description', v_page.description,
    'ask_email', v_page.ask_email,
    'ask_group', v_page.ask_group,
    'groups', to_jsonb(v_page.groups),
    'project_name', v_page.project_name
  );
end;
$$;

-- Stores a public registration. When the page is configured for auto-transfer
-- the registration is immediately turned into a project member.
create or replace function public.submit_public_registration(
  p_token text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_group_name text
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
  v_registration_id uuid;
  v_member_id uuid := null;
begin
  if v_first_name = '' or v_last_name = ''
     or length(v_first_name) > 120 or length(v_last_name) > 120
     or length(coalesce(v_email, '')) > 200
     or length(coalesce(v_group_name, '')) > 120 then
    return jsonb_build_object('state', 'invalid_input');
  end if;

  select rp.id, rp.project_id, rp.is_active, rp.ask_email, rp.ask_group,
         rp.auto_transfer
    into v_page
  from public.registration_pages rp
  where rp.token::text = p_token;

  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;

  if not v_page.is_active then
    return jsonb_build_object('state', 'inactive');
  end if;

  if not v_page.ask_email then
    v_email := null;
  end if;
  if not v_page.ask_group then
    v_group_name := null;
  end if;

  if v_page.auto_transfer then
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
  )
  returning id into v_registration_id;

  return jsonb_build_object('state', 'success');
end;
$$;

-- Transfer a single registration into the member directory.
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
         rp.project_id
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

  insert into public.members (project_id, first_name, last_name, group_name, email, status)
  values (v_reg.project_id, v_reg.first_name, v_reg.last_name, v_reg.group_name, v_reg.email, 'active')
  returning id into v_member_id;

  update public.registrations
  set transferred = true, member_id = v_member_id
  where id = p_registration_id;

  return jsonb_build_object('success', true, 'transferred', 1);
end;
$$;

-- Transfer every not-yet-transferred registration of a page in one transaction.
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
    select id, first_name, last_name, email, group_name
    from public.registrations
    where registration_page_id = p_page_id and not transferred
    order by created_at
  loop
    insert into public.members (project_id, first_name, last_name, group_name, email, status)
    values (v_project_id, v_reg.first_name, v_reg.last_name, v_reg.group_name, v_reg.email, 'active')
    returning id into v_member_id;

    update public.registrations
    set transferred = true, member_id = v_member_id
    where id = v_reg.id;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('success', true, 'transferred', v_count);
end;
$$;

revoke all on function public.get_public_registration(text) from public;
revoke all on function public.submit_public_registration(text, text, text, text, text) from public;
revoke all on function public.transfer_registration(uuid) from public;
revoke all on function public.transfer_all_registrations(uuid) from public;
grant execute on function public.get_public_registration(text) to anon, authenticated;
grant execute on function public.submit_public_registration(text, text, text, text, text) to anon, authenticated;
grant execute on function public.transfer_registration(uuid) to authenticated;
grant execute on function public.transfer_all_registrations(uuid) to authenticated;
