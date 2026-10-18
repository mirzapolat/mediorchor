-- Folders on a piece's "Dateien" page: managers group the files (e.g. one
-- folder per voice) and order folders and files by dragging. A file without
-- a folder is listed above the folders; deleting a folder keeps its files.
create table piece_file_folders (
  id         text primary key default (uuid()),
  piece_id   text not null references pieces (id) on delete cascade,
  name       text not null default '',
  position   integer not null default 0,
  created_at text not null default (now_iso())
);
create index piece_file_folders_piece on piece_file_folders (piece_id, position);

alter table piece_files add column folder_id text references piece_file_folders (id) on delete set null;
