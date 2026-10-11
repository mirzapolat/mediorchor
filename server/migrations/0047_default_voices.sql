-- Every piece starts with the usual voices (Tutti, Sopran, Alt, Tenor,
-- Bass), still without recordings; uploads are assigned to them by hand.
create trigger pieces_default_voices
after insert on pieces
for each row
begin
  insert into piece_tracks (piece_id, title, position)
  values (new.id, 'Tutti', 0), (new.id, 'Sopran', 1), (new.id, 'Alt', 2), (new.id, 'Tenor', 3), (new.id, 'Bass', 4);
end;

-- Pieces without any voice so far get them too.
insert into piece_tracks (piece_id, title, position)
select p.id, v.title, v.position
from pieces p
cross join (
  select 'Tutti' as title, 0 as position
  union all select 'Sopran', 1
  union all select 'Alt', 2
  union all select 'Tenor', 3
  union all select 'Bass', 4
) v
where not exists (select 1 from piece_tracks t where t.piece_id = p.id);
