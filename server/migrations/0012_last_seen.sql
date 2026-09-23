-- When each account was last active (any signed-in request, recorded at most
-- every few minutes). Admins see it in the user list. Existing accounts start
-- from their newest session.
alter table auth_users add column last_seen_at text;

update auth_users set last_seen_at = (
  select max(s.created_at) from auth_sessions s where s.user_id = auth_users.id
);
