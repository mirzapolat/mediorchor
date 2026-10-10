-- Email addresses are stored lowercase (and trimmed) everywhere. Existing
-- rows are normalized once; triggers keep every later write that way, whichever
-- path it takes (forms, imports, webhooks, sign-up, email change). ulower() is
-- the Unicode-aware lower() (SQLite's own only folds ASCII).
--
-- auth_users.email is unique (nocase, ASCII only), so an address that would
-- collide with another account after Unicode folding is left as it is.
update auth_users set email = ulower(trim(email))
where email is not ulower(trim(email))
  and not exists (
    select 1 from auth_users other
    where other.id <> auth_users.id and ulower(trim(other.email)) = ulower(trim(auth_users.email))
  );

update auth_tokens set email = ulower(trim(email)) where email is not ulower(trim(email));
update app_users set email = ulower(trim(email)) where email is not ulower(trim(email));
update members set email = ulower(trim(email)) where email is not ulower(trim(email));
update registrations set email = ulower(trim(email)) where email is not ulower(trim(email));

create trigger auth_users_email_lower_insert after insert on auth_users
when new.email is not ulower(trim(new.email))
begin
  update auth_users set email = ulower(trim(new.email)) where rowid = new.rowid;
end;
create trigger auth_users_email_lower_update after update of email on auth_users
when new.email is not ulower(trim(new.email))
begin
  update auth_users set email = ulower(trim(new.email)) where rowid = new.rowid;
end;

create trigger auth_tokens_email_lower_insert after insert on auth_tokens
when new.email is not ulower(trim(new.email))
begin
  update auth_tokens set email = ulower(trim(new.email)) where rowid = new.rowid;
end;
create trigger auth_tokens_email_lower_update after update of email on auth_tokens
when new.email is not ulower(trim(new.email))
begin
  update auth_tokens set email = ulower(trim(new.email)) where rowid = new.rowid;
end;

create trigger app_users_email_lower_insert after insert on app_users
when new.email is not ulower(trim(new.email))
begin
  update app_users set email = ulower(trim(new.email)) where rowid = new.rowid;
end;
create trigger app_users_email_lower_update after update of email on app_users
when new.email is not ulower(trim(new.email))
begin
  update app_users set email = ulower(trim(new.email)) where rowid = new.rowid;
end;

create trigger members_email_lower_insert after insert on members
when new.email is not ulower(trim(new.email))
begin
  update members set email = ulower(trim(new.email)) where rowid = new.rowid;
end;
create trigger members_email_lower_update after update of email on members
when new.email is not ulower(trim(new.email))
begin
  update members set email = ulower(trim(new.email)) where rowid = new.rowid;
end;

create trigger registrations_email_lower_insert after insert on registrations
when new.email is not ulower(trim(new.email))
begin
  update registrations set email = ulower(trim(new.email)) where rowid = new.rowid;
end;
create trigger registrations_email_lower_update after update of email on registrations
when new.email is not ulower(trim(new.email))
begin
  update registrations set email = ulower(trim(new.email)) where rowid = new.rowid;
end;
