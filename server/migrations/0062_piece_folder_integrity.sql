-- The folder tree on a piece's "Dateien" page keeps itself whole: deleting a
-- folder moves what is in it up one level (in the same write, so a failed
-- request can't scatter it to the top), and folders only ever point at
-- folders of their own piece. Cycles are refused by the data API
-- (server/policies.ts); ones already stored are broken up here.

-- Parents and folders of another piece count as gone.
update piece_file_folders set parent_id = null
where parent_id is not null and not exists (
  select 1 from piece_file_folders p where p.id = piece_file_folders.parent_id and p.piece_id = piece_file_folders.piece_id
);
update piece_files set folder_id = null
where folder_id is not null and not exists (
  select 1 from piece_file_folders d where d.id = piece_files.folder_id and d.piece_id = piece_files.piece_id
);

-- A folder that is (indirectly) its own parent moves to the top.
with recursive up (start, id, depth) as (
  select id, parent_id, 1 from piece_file_folders where parent_id is not null
  union all
  select up.start, d.parent_id, up.depth + 1
  from up join piece_file_folders d on d.id = up.id
  where d.parent_id is not null and up.start <> up.id and up.depth < 1000
)
update piece_file_folders set parent_id = null where id in (select start from up where id = start);

create trigger piece_file_folders_delete
before delete on piece_file_folders
for each row
begin
  update piece_file_folders set parent_id = old.parent_id where parent_id = old.id;
  update piece_files set folder_id = old.parent_id where folder_id = old.id;
end;
