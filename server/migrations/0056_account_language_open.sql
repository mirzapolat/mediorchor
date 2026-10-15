-- Account languages are no longer a fixed list in the schema: the server
-- checks them against shared/languages.ts (server/policies.ts), so adding a
-- language needs no migration. SQLite can't drop a CHECK in place, so the
-- column is copied without it.
alter table app_users add column language_new text;
update app_users set language_new = language;
alter table app_users drop column language;
alter table app_users rename column language_new to language;
