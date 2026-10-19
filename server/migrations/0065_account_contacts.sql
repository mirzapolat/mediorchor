-- Contact details an account adds in its profile settings: any number, each
-- of a kind (phone, email, messengers, social networks, website or other),
-- with an optional own label ("Mobil", "Arbeit") and its place in the list.
-- Seen by the account itself and by those who manage projects.
create table account_contacts (
  id         text primary key default (uuid()),
  user_id    text not null references app_users (id) on delete cascade,
  kind       text not null,
  label      text not null default '',
  value      text not null,
  position   integer not null default 0,
  created_at text not null default (now_iso())
);
create index account_contacts_user on account_contacts (user_id, position);
