-- Project access becomes two independent grants:
--   can_manage_projects → every project (current and future)
--   user_projects rows  → exactly those projects, regardless of the flag
-- Previously user_projects only applied to managers with all_projects = 0.

-- Rows only took effect for scoped managers; drop the inert ones so the
-- migration grants nobody new access.
delete from user_projects
where user_id not in (
  select id from app_users where can_manage_projects and not all_projects and not is_admin
);

-- Scoped managers keep their selected projects but lose the global grant.
update app_users set can_manage_projects = 0 where can_manage_projects and not all_projects;

alter table app_users drop column all_projects;
