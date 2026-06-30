-- ============================================================================
-- Public QR check-in for events.
-- Anonymous visitors only interact through the two security-definer functions
-- below; project members and the member directory stay protected by RLS.
-- ============================================================================

create table if not exists public.event_checkins (
  event_id          uuid primary key references public.events (id) on delete cascade,
  token             uuid not null default gen_random_uuid() unique,
  is_active         boolean not null default false,
  attendance_status text not null default 'attended'
                    check (attendance_status in ('attended', 'excused')),
  updated_at        timestamptz not null default now()
);

create table if not exists public.checkin_submissions (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.events (id) on delete cascade,
  member_id         uuid references public.members (id) on delete set null,
  first_name        text not null,
  last_name         text not null,
  group_name        text not null,
  recognized        boolean not null,
  attendance_status text check (attendance_status in ('attended', 'excused')),
  submitted_at      timestamptz not null default now()
);
create index if not exists checkin_submissions_event_idx
  on public.checkin_submissions (event_id, submitted_at desc);

alter table public.event_checkins enable row level security;
alter table public.checkin_submissions enable row level security;

drop policy if exists event_checkins_authenticated on public.event_checkins;
create policy event_checkins_authenticated on public.event_checkins
  for all to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_checkins.event_id
        and public.can_access_project(e.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = event_checkins.event_id
        and public.can_access_project(e.project_id)
    )
  );

drop policy if exists checkin_submissions_authenticated on public.checkin_submissions;
create policy checkin_submissions_authenticated on public.checkin_submissions
  for select to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = checkin_submissions.event_id
        and public.can_access_project(e.project_id)
    )
  );

-- Returns only the small amount of information required to render the public
-- form. It deliberately never exposes member names.
create or replace function public.get_public_checkin(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_checkin record;
  v_groups jsonb;
begin
  select c.event_id, c.is_active, e.name as event_name,
         e.project_id, p.name as project_name
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

  return jsonb_build_object(
    'state', 'active',
    'event_name', v_checkin.event_name,
    'project_name', v_checkin.project_name,
    'groups', v_groups
  );
end;
$$;

-- Matches first name AND last name AND group inside the event's project. The
-- attendance update and audit-row insert happen atomically in this function.
create or replace function public.submit_public_checkin(
  p_token text,
  p_first_name text,
  p_last_name text,
  p_group_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_checkin record;
  v_member_id uuid;
  v_first_name text := btrim(p_first_name);
  v_last_name text := btrim(p_last_name);
  v_group_name text := btrim(p_group_name);
begin
  if v_first_name = '' or v_last_name = '' or v_group_name = ''
     or length(v_first_name) > 120 or length(v_last_name) > 120
     or length(v_group_name) > 120 then
    return jsonb_build_object('state', 'invalid_input');
  end if;

  select c.event_id, c.is_active, c.attendance_status, e.project_id
    into v_checkin
  from public.event_checkins c
  join public.events e on e.id = c.event_id
  where c.token::text = p_token;

  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;

  if not v_checkin.is_active then
    return jsonb_build_object('state', 'stopped');
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

revoke all on function public.get_public_checkin(text) from public;
revoke all on function public.submit_public_checkin(text, text, text, text) from public;
grant execute on function public.get_public_checkin(text) to anon, authenticated;
grant execute on function public.submit_public_checkin(text, text, text, text) to anon, authenticated;
