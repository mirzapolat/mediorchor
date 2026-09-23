-- ---------------------------------------------------------------------------
-- Groups move from the projects.groups JSON list into their own table with a
-- color and an explicit order. members.group_name keeps referencing a group
-- by name; the triggers below keep the two in sync.
-- ---------------------------------------------------------------------------

create table project_groups (
  id         text primary key default (uuid()),
  project_id text not null references projects (id) on delete cascade,
  name       text not null collate nocase,
  color      text not null default '#64748b',
  position   integer not null default 0,
  created_at text not null default (now_iso()),
  unique (project_id, name)
);
create index project_groups_project_idx on project_groups (project_id, position);

-- Default palette, cycled by position (mirrors src/lib/groupColors.ts).
insert or ignore into project_groups (project_id, name, color, position)
select p.id, trim(j.value),
  case cast(j.key as integer) % 10
    when 0 then '#e11d48' when 1 then '#ea580c' when 2 then '#ca8a04'
    when 3 then '#16a34a' when 4 then '#0d9488' when 5 then '#0284c7'
    when 6 then '#4f46e5' when 7 then '#9333ea' when 8 then '#db2777'
    else '#64748b'
  end,
  cast(j.key as integer)
from projects p, json_each(p.groups) j
where trim(j.value) <> '';

drop trigger members_sync_project_groups_insert;
drop trigger members_sync_project_groups_update;
alter table projects drop column groups;

-- Safety net: a member's group always exists in the project's group table.
create trigger members_group_exists_insert
after insert on members
for each row
when new.group_name is not null and trim(new.group_name) <> ''
begin
  insert or ignore into project_groups (project_id, name, color, position)
  select new.project_id, new.group_name,
    case count(*) % 10
      when 0 then '#e11d48' when 1 then '#ea580c' when 2 then '#ca8a04'
      when 3 then '#16a34a' when 4 then '#0d9488' when 5 then '#0284c7'
      when 6 then '#4f46e5' when 7 then '#9333ea' when 8 then '#db2777'
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
      when 0 then '#e11d48' when 1 then '#ea580c' when 2 then '#ca8a04'
      when 3 then '#16a34a' when 4 then '#0d9488' when 5 then '#0284c7'
      when 6 then '#4f46e5' when 7 then '#9333ea' when 8 then '#db2777'
      else '#64748b'
    end,
    coalesce(max(position) + 1, 0)
  from project_groups where project_id = new.project_id;
end;

-- Renaming a group renames it on its members and pending registrations.
create trigger project_groups_rename
after update of name on project_groups
for each row
when new.name collate binary is not old.name
begin
  update members set group_name = new.name
  where project_id = new.project_id and ulower(group_name) = ulower(old.name);
  update registrations set group_name = new.name
  where not transferred and ulower(group_name) = ulower(old.name)
    and registration_page_id in (select id from registration_pages where project_id = new.project_id);
end;

-- Deleting a group leaves its members without a group.
create trigger project_groups_delete
after delete on project_groups
for each row
begin
  update members set group_name = null
  where project_id = old.project_id and ulower(group_name) = ulower(old.name);
end;
