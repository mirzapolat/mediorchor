-- A piece's files carry what the "Dateien" page lists about them: size, who
-- uploaded them, when they were last replaced, and whether the stored object
-- has gone missing. All are set by the server (server/policies.ts and the
-- maintenance job in server/pieceFileMaintenance.ts), never by the browser.
alter table piece_files add column size integer;
alter table piece_files add column uploaded_by text;
alter table piece_files add column uploaded_by_name text not null default '';
alter table piece_files add column replaced_at text;
alter table piece_files add column file_missing boolean not null default 0;

-- Public / private ("downloadable") now works like a file system: an item is
-- public when it and every folder above it are. A file inside a folder used
-- to follow its folder only, so its own switch starts as public.
update piece_files set downloadable = 1
where folder_id is not null and exists (select 1 from piece_file_folders d where d.id = piece_files.folder_id);

-- Who may read a stored object is looked up by its key.
create index piece_files_file_path on piece_files (file_path);

-- Deleted files wait here for 30 days before their stored objects go: `row`
-- is the piece_files row as it was, `links` where the piece used it (its
-- score, notation, timing or trainer file, and voices' recordings), so a
-- restore puts both back.
create table piece_file_trash (
  id              text primary key default (uuid()),
  piece_id        text not null references pieces (id) on delete cascade,
  file_id         text not null,
  row             json not null,
  links           json not null default '{}',
  deleted_by_name text not null default '',
  deleted_at      text not null default (now_iso())
);
create index piece_file_trash_piece on piece_file_trash (piece_id, deleted_at);
