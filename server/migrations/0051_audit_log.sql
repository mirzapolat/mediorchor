-- Audit log (Admin Config → Audit-Log): one row per action — a request, a
-- sign-in, a background job — and the row changes it caused. Changes are
-- captured by triggers that server/audit.ts installs on every table at
-- start-up, so no write path can bypass them.
--
-- No foreign keys: entries must outlive the accounts and rows they mention.
-- Not exposed through /api/db (no policy), so nobody can edit or delete them
-- from the app.
create table audit_log (
  id text primary key,
  at text not null,
  -- user | anonymous | system | webhook
  actor_kind text not null,
  actor_id text,
  -- Snapshots, so the entry still names a person after their account is gone.
  actor_name text,
  actor_email text,
  -- auth | data | public | files | admin | webhook | system
  category text not null,
  -- Machine key, e.g. db.update, rpc.join_project, auth.login (see src/lib/audit.ts).
  action text not null,
  -- The table of a data request, the bucket of a file action.
  target text,
  method text,
  path text,
  ip text,
  user_agent text,
  -- ok | failed
  status text not null default 'ok',
  error text,
  details json,
  change_count integer not null default 0
);
create index audit_log_actor on audit_log (actor_id);
create index audit_log_at on audit_log (at);

create table audit_changes (
  id integer primary key,
  log_id text not null,
  table_name text not null,
  -- insert | update | delete
  op text not null,
  row_key text,
  -- The row's display name at the time (a person's name, a Probe's name …).
  label text,
  -- insert/delete: { column: value }, update: { column: [old, new] }.
  data json,
  -- Rows it points to: { column: { id, label } }, resolved when logged.
  refs json
);
create index audit_changes_log on audit_changes (log_id);
