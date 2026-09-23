-- New accounts are offered to add a profile photo once, on their first
-- sign-in. Existing accounts count as already asked.
alter table app_users add column photo_prompted_at text;

update app_users set photo_prompted_at = now_iso();
