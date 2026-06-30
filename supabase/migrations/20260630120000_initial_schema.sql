-- ============================================================================
-- Initial schema: extensions, tables, helper function, settings singleton.
-- ============================================================================

create extension if not exists pgcrypto;

-- App users mirror auth.users and hold profile + role. Exactly one row should
-- have role = 'owner'.
create table if not exists public.app_users (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  name        text not null default '',
  role        text not null default 'member' check (role in ('owner', 'member')),
  created_at  timestamptz not null default now()
);

-- Singleton branding/settings row (id is always 1).
create table if not exists public.app_settings (
  id            int primary key default 1 check (id = 1),
  app_name      text not null default 'Anwesenheit',
  accent_color  text not null default '#efa100',
  icon          text default 'CheckSquare',
  language      text not null default 'en' check (language in ('de', 'en'))
);

insert into public.app_settings (id) values (1)
  on conflict (id) do nothing;

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  color       text not null default '#1a1a1a',
  icon        text default 'Folder',
  status      text not null default 'active' check (status in ('active', 'archived')),
  created_at  timestamptz not null default now(),
  created_by  uuid references public.app_users (id) on delete set null
);

create table if not exists public.members (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  first_name  text not null,
  last_name   text not null,
  group_name  text,
  email       text,
  photo_url   text,
  status      text not null default 'active' check (status in ('active', 'archived', 'guest')),
  created_at  timestamptz not null default now()
);
create index if not exists members_project_idx on public.members (project_id);

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null,
  date        date,
  time        text,
  created_at  timestamptz not null default now()
);
create index if not exists events_project_idx on public.events (project_id);

create table if not exists public.attendance (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  member_id  uuid not null references public.members (id) on delete cascade,
  status     text not null default 'not_attended'
             check (status in ('not_attended', 'attended', 'excused')),
  is_guest   boolean not null default false,
  unique (event_id, member_id)
);
create index if not exists attendance_event_idx on public.attendance (event_id);
create index if not exists attendance_member_idx on public.attendance (member_id);

-- Helper: is the current auth user the owner?
create or replace function public.is_owner()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_users
    where id = auth.uid() and role = 'owner'
  );
$$;
