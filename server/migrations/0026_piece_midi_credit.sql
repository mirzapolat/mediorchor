-- The piece page credits whoever made the MIDI files, instead of showing
-- notes (the notes column stays, so no text written so far is lost).
-- The credit is a name, optionally linked to an account; a linked account's
-- profile photo is mirrored here (like on members), so everyone who sees the
-- piece sees the photo without reading accounts.
alter table pieces add column midi_credit_name text not null default '';
alter table pieces add column midi_credit_user_id text references app_users (id) on delete set null;
alter table pieces add column midi_credit_photo_url text;

create trigger app_users_sync_piece_credit_photo
after update of photo_url on app_users
for each row
when new.photo_url is not old.photo_url
begin
  update pieces set midi_credit_photo_url = new.photo_url where midi_credit_user_id = new.id;
end;

-- Linking or unlinking an account (also when it is deleted) swaps the photo.
create trigger pieces_credit_photo_from_account_insert
after insert on pieces
for each row
when new.midi_credit_user_id is not null
begin
  update pieces
  set midi_credit_photo_url = (select u.photo_url from app_users u where u.id = new.midi_credit_user_id)
  where id = new.id;
end;

create trigger pieces_credit_photo_from_account_update
after update of midi_credit_user_id on pieces
for each row
when new.midi_credit_user_id is not old.midi_credit_user_id
begin
  update pieces
  set midi_credit_photo_url = (select u.photo_url from app_users u where u.id = new.midi_credit_user_id)
  where id = new.id;
end;
