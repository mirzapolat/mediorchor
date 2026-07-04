-- ============================================================================
-- Pieces (Stücke).
-- Each project keeps a sortable list of musical pieces. A piece has its own
-- info page built from sortable content blocks: downloadable files, playable
-- audio files, external links and Markdown text.
-- ============================================================================

create table if not exists public.pieces (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name       text not null,
  composer   text not null default '',
  position   int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists pieces_project_idx
  on public.pieces (project_id, position);

create table if not exists public.piece_blocks (
  id         uuid primary key default gen_random_uuid(),
  piece_id   uuid not null references public.pieces (id) on delete cascade,
  type       text not null check (type in ('file', 'audio', 'link', 'text')),
  title      text not null default '',
  url        text,          -- link blocks: the target URL
  file_path  text,          -- file/audio blocks: object key in the piece-files bucket
  file_name  text,          -- file/audio blocks: original file name used for downloads
  content    text,          -- text blocks: Markdown source
  position   int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists piece_blocks_piece_idx
  on public.piece_blocks (piece_id, position);

alter table public.pieces enable row level security;
alter table public.piece_blocks enable row level security;

drop policy if exists pieces_authenticated on public.pieces;
create policy pieces_authenticated on public.pieces
  for all to authenticated
  using (public.can_access_project(project_id))
  with check (public.can_access_project(project_id));

drop policy if exists piece_blocks_authenticated on public.piece_blocks;
create policy piece_blocks_authenticated on public.piece_blocks
  for all to authenticated
  using (
    exists (
      select 1 from public.pieces p
      where p.id = piece_blocks.piece_id
        and public.can_access_project(p.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.pieces p
      where p.id = piece_blocks.piece_id
        and public.can_access_project(p.project_id)
    )
  );

-- Storage: public bucket for piece attachments (PDFs, audio files, …).
insert into storage.buckets (id, name, public)
  values ('piece-files', 'piece-files', true)
  on conflict (id) do nothing;

drop policy if exists piece_files_read on storage.objects;
create policy piece_files_read on storage.objects
  for select using (bucket_id = 'piece-files');

-- Object keys are "<pieceId>/<uuid>.<ext>"; writes are only allowed when the
-- piece behind that prefix belongs to a project the user can access.
create or replace function public.can_write_piece_file(object_name text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from public.pieces p
    where p.id::text = split_part(object_name, '/', 1)
      and public.can_access_project(p.project_id)
  );
$$;

drop policy if exists piece_files_write on storage.objects;
create policy piece_files_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'piece-files' and public.can_write_piece_file(name));

drop policy if exists piece_files_update on storage.objects;
create policy piece_files_update on storage.objects
  for update to authenticated
  using (bucket_id = 'piece-files' and public.can_write_piece_file(name))
  with check (bucket_id = 'piece-files' and public.can_write_piece_file(name));

drop policy if exists piece_files_delete on storage.objects;
create policy piece_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'piece-files' and public.can_write_piece_file(name));
