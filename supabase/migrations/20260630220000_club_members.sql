-- ============================================================================
-- Club members ("Vereinsmitglieder").
-- A standalone, workspace-wide directory of the association's members. This is
-- intentionally unrelated to project `members`, which are scoped to a project
-- and used for attendance.
-- ============================================================================

create table if not exists public.club_members (
  id            uuid primary key default gen_random_uuid(),
  title         text,
  salutation    text,
  first_name    text not null,
  last_name     text not null,
  care_of       text, -- "Zusatz / c/o"
  street        text, -- "Straße und Hausnummer"
  address_extra text, -- "Adresszusatz" (Gebäude, Stockwerk, Wohnung)
  postal_code   text, -- "PLZ"
  city          text, -- "Ort / Stadt"
  country       text, -- "Land"
  email         text,
  phone         text,
  status        text not null default 'active' check (status in ('active', 'passive')),
  created_at    timestamptz not null default now()
);
create index if not exists club_members_name_idx
  on public.club_members (last_name, first_name);

-- Access to the club directory is granted per user (off by default). The owner
-- always has access.
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

alter table public.club_members enable row level security;

-- Only users with the club permission (or the owner) may manage the directory.
drop policy if exists club_members_authenticated on public.club_members;
create policy club_members_authenticated on public.club_members
  for all to authenticated
  using (public.can_access_club())
  with check (public.can_access_club());
