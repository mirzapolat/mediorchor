-- A piece's "Konfiguration" no longer shows every uploaded file: its editors
-- add the files they want to wire as nodes (and remove them again). Nodes
-- keep their own order there, so arranging them leaves the "Dateien" page's
-- order alone. Files already wired start as nodes, in their current order.
alter table piece_files add column in_setup boolean not null default 0;
alter table piece_files add column setup_position integer not null default 0;

update piece_files set in_setup = 1, setup_position = position
where exists (
  select 1 from pieces p
  where p.id = piece_files.piece_id
    and piece_files.id in (p.score_file_id, p.notation_file_id, p.timing_file_id, p.trainer_file_id)
) or exists (
  select 1 from piece_tracks t
  where t.piece_id = piece_files.piece_id
    and piece_files.id in (t.file_id, t.click_file_id, t.quiet_file_id, t.quiet_click_file_id)
);
