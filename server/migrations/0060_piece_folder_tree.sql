-- Folders on a piece's "Dateien" page become a tree (folders in folders,
-- opened with breadcrumbs) and carry the download switch: a file in a
-- folder is downloadable when every folder above it is; a file outside any
-- folder keeps its own switch. The voices' switch (piece_tracks.downloadable)
-- is no longer used: a recording a voice used gets the voice's setting as
-- its own, so nothing changes for members.
alter table piece_file_folders add column parent_id text references piece_file_folders (id) on delete set null;
alter table piece_file_folders add column downloadable boolean not null default 1;

update piece_files set downloadable = exists (
  select 1 from piece_tracks t
  where t.downloadable
    and piece_files.id in (t.file_id, t.click_file_id, t.quiet_file_id, t.quiet_click_file_id)
)
where exists (
  select 1 from piece_tracks t
  where piece_files.id in (t.file_id, t.click_file_id, t.quiet_file_id, t.quiet_click_file_id)
);
