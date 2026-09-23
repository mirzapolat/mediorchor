-- Profile photos belong to accounts: only the account holder sets one, and it
-- is mirrored onto every member row linked to that account. Members without an
-- account have no photo; managers can no longer set one by hand.
alter table app_users add column photo_url text;

-- Drop photos managers set by hand.
update members set photo_url = null;

create trigger app_users_sync_member_photo
after update of photo_url on app_users
for each row
when new.photo_url is not old.photo_url
begin
  update members set photo_url = new.photo_url where user_id = new.id;
end;

-- A new member row always takes its account's photo (or none), whatever the
-- insert carried.
create trigger members_photo_from_account_insert
after insert on members
for each row
begin
  update members
  set photo_url = (select u.photo_url from app_users u where u.id = new.user_id)
  where id = new.id;
end;

-- Linking or unlinking an account swaps the photo accordingly.
create trigger members_photo_from_account_update
after update of user_id on members
for each row
when new.user_id is not old.user_id
begin
  update members
  set photo_url = (select u.photo_url from app_users u where u.id = new.user_id)
  where id = new.id;
end;
