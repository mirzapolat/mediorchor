-- New palette order for automatically created groups (matches
-- src/lib/groupColors.ts). Existing groups keep their colors.

drop trigger members_group_exists_insert;
drop trigger members_group_exists_update;

create trigger members_group_exists_insert
after insert on members
for each row
when new.group_name is not null and trim(new.group_name) <> ''
begin
  insert or ignore into project_groups (project_id, name, color, position)
  select new.project_id, new.group_name,
    case count(*) % 10
      when 0 then '#0284c7' when 1 then '#ea580c' when 2 then '#16a34a'
      when 3 then '#9333ea' when 4 then '#ca8a04' when 5 then '#e11d48'
      when 6 then '#0d9488' when 7 then '#4f46e5' when 8 then '#db2777'
      else '#64748b'
    end,
    coalesce(max(position) + 1, 0)
  from project_groups where project_id = new.project_id;
end;

create trigger members_group_exists_update
after update of group_name on members
for each row
when new.group_name is not null and trim(new.group_name) <> ''
  and new.group_name is not old.group_name
begin
  insert or ignore into project_groups (project_id, name, color, position)
  select new.project_id, new.group_name,
    case count(*) % 10
      when 0 then '#0284c7' when 1 then '#ea580c' when 2 then '#16a34a'
      when 3 then '#9333ea' when 4 then '#ca8a04' when 5 then '#e11d48'
      when 6 then '#0d9488' when 7 then '#4f46e5' when 8 then '#db2777'
      else '#64748b'
    end,
    coalesce(max(position) + 1, 0)
  from project_groups where project_id = new.project_id;
end;
