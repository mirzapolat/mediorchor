-- Accounts store first and last name. `name` stays as "first last", derived
-- by SQLite so everything reading it keeps working; it can't be written.

alter table app_users add column first_name text not null default '';
alter table app_users add column last_name text not null default '';

-- Existing names are split at the last space (the rule used so far):
-- rtrim(s, <every non-space char of s>) strips back to the last space.
update app_users
set first_name = case
      when instr(trim(name), ' ') = 0 then trim(name)
      else trim(rtrim(trim(name), replace(trim(name), ' ', '')))
    end,
    last_name = case
      when instr(trim(name), ' ') = 0 then ''
      else trim(substr(trim(name), length(rtrim(trim(name), replace(trim(name), ' ', ''))) + 1))
    end;

drop trigger app_users_sync_member_names;
alter table app_users drop column name;
alter table app_users add column name text generated always as (trim(first_name || ' ' || last_name)) virtual;

-- Keep linked member names in sync with the account's.
create trigger app_users_sync_member_names
after update of first_name, last_name on app_users
for each row
when trim(new.first_name || new.last_name) <> ''
  and (new.first_name is not old.first_name or new.last_name is not old.last_name)
begin
  update members
  set first_name = trim(new.first_name),
      last_name = trim(new.last_name)
  where user_id = new.id;
end;
