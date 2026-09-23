-- ---------------------------------------------------------------------------
-- projects.groups is the single source of truth for a project's groups.
-- Backfill: append every group members already use but the list is missing
-- (projects without a list used to fall back to exactly those groups).
-- ---------------------------------------------------------------------------

update projects
set groups = (
  select json_group_array(value) from (
    select value from (
      select j.value, 0 as src, cast(j.key as integer) as pos
      from json_each(projects.groups) j
      union all
      select g.group_name, 1, 0 from (
        select distinct m.group_name from members m
        where m.project_id = projects.id
          and m.group_name is not null and trim(m.group_name) <> ''
          and not exists (select 1 from json_each(projects.groups) j2 where j2.value = m.group_name)
        order by m.group_name
      ) g
    )
    order by src, pos, value
  )
);

-- Same for legacy per-registration-page group lists.
update projects
set groups = (
  select json_group_array(value) from (
    select value from (
      select j.value, 0 as src, cast(j.key as integer) as pos
      from json_each(projects.groups) j
      union all
      select g.value, 1, 0 from (
        select distinct pg.value from registration_pages rp, json_each(rp.groups) pg
        where rp.project_id = projects.id
          and pg.value is not null and trim(pg.value) <> ''
          and not exists (select 1 from json_each(projects.groups) j2 where j2.value = pg.value)
        order by pg.value
      ) g
    )
    order by src, pos, value
  )
);

-- Safety net: a member can never end up in a group the project doesn't list.
create trigger members_sync_project_groups_insert
after insert on members
for each row
when new.group_name is not null and trim(new.group_name) <> ''
begin
  update projects
  set groups = json_insert(groups, '$[#]', new.group_name)
  where id = new.project_id
    and not exists (select 1 from json_each(projects.groups) where value = new.group_name);
end;

create trigger members_sync_project_groups_update
after update of group_name on members
for each row
when new.group_name is not null and trim(new.group_name) <> ''
  and new.group_name is not old.group_name
begin
  update projects
  set groups = json_insert(groups, '$[#]', new.group_name)
  where id = new.project_id
    and not exists (select 1 from json_each(projects.groups) where value = new.group_name);
end;

-- ---------------------------------------------------------------------------
-- Link member rows to the account with the same (confirmed) email as soon as
-- they are created or their email changes, not only on the next sign-in.
-- Never creates a second link for the same account within a project.
-- ---------------------------------------------------------------------------

create trigger members_link_account_insert
after insert on members
for each row
when new.user_id is null and trim(coalesce(new.email, '')) <> ''
begin
  update members
  set user_id = (
    select au.id from auth_users au
    where au.email_confirmed_at is not null
      and ulower(au.email) = ulower(trim(new.email))
    limit 1
  )
  where id = new.id
    and exists (
      select 1 from auth_users au
      where au.email_confirmed_at is not null
        and ulower(au.email) = ulower(trim(new.email))
        and not exists (
          select 1 from members m2 where m2.project_id = new.project_id and m2.user_id = au.id
        )
    );
end;

create trigger members_link_account_update
after update of email on members
for each row
when new.user_id is null and trim(coalesce(new.email, '')) <> ''
  and new.email is not old.email
begin
  update members
  set user_id = (
    select au.id from auth_users au
    where au.email_confirmed_at is not null
      and ulower(au.email) = ulower(trim(new.email))
    limit 1
  )
  where id = new.id
    and exists (
      select 1 from auth_users au
      where au.email_confirmed_at is not null
        and ulower(au.email) = ulower(trim(new.email))
        and not exists (
          select 1 from members m2 where m2.project_id = new.project_id and m2.user_id = au.id
        )
    );
end;

-- Link rows that already match today.
update members
set user_id = (
  select au.id from auth_users au
  where au.email_confirmed_at is not null
    and ulower(au.email) = ulower(trim(members.email))
  limit 1
)
where user_id is null
  and trim(coalesce(email, '')) <> ''
  and rowid = (
    select m.rowid from members m
    where m.project_id = members.project_id
      and m.user_id is null
      and ulower(trim(m.email)) = ulower(trim(members.email))
    order by m.created_at
    limit 1
  )
  and exists (
    select 1 from auth_users au
    where au.email_confirmed_at is not null
      and ulower(au.email) = ulower(trim(members.email))
      and not exists (
        select 1 from members m2 where m2.project_id = members.project_id and m2.user_id = au.id
      )
  );
