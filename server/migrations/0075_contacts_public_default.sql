-- Contact details are public by default (an intranet): existing ones become
-- public, and new ones start public. SQLite can't change a column's default,
-- so the table is rebuilt (nothing references it).
create table account_contacts_new (
  id         text primary key default (uuid()),
  user_id    text not null references app_users (id) on delete cascade,
  kind       text not null,
  label      text not null default '',
  value      text not null,
  position   integer not null default 0,
  created_at text not null default (now_iso()),
  room_share text not null default 'private' check (room_share in ('private', 'weekend', 'room')),
  public     boolean not null default 1
);
insert into account_contacts_new (id, user_id, kind, label, value, position, created_at, room_share, public)
  select id, user_id, kind, label, value, position, created_at, room_share, 1 from account_contacts;
drop table account_contacts;
alter table account_contacts_new rename to account_contacts;
create index account_contacts_user on account_contacts (user_id, position);
