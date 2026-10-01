-- Only one person places bar markers on a piece at a time. The lock is held
-- while the editor is open and renewed by a heartbeat; a lock whose heartbeat
-- is older than a minute (closed tab, lost connection) has expired.
alter table pieces add column markers_locked_by text references app_users (id) on delete set null;
alter table pieces add column markers_locked_name text;
alter table pieces add column markers_locked_at text;
