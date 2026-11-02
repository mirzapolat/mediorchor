// Papierkorb. Deleting one of the TRASHABLE rows through the data API
// (rest.ts) first keeps a snapshot: the row, every row that goes with it by
// a cascading foreign key (a project's members, Proben and their attendance,
// a survey's answers and uploads, ...) and the values the deletion clears in
// rows that stay (foreign keys set null, a deleted group's name on its
// members) — so that restoring puts everything back as it was. Entries are
// kept for RETENTION_DAYS. Stored files stay as long as an entry points at
// them (the maintenance jobs of pieceFiles.ts, concerts.ts and forms.ts read
// trash_rows), so nothing has to be removed on disk here.
import { db, authUid, ApiError, nowIso, uuid } from './db.ts';
import { canAccessProject, canEditCalendars, canManageProjects, hasFullPieceAccess } from './policies.ts';
import { auditNote } from './audit.ts';

export const RETENTION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

type Row = Record<string, unknown>;
type Args = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));

const projectOfPage = (pageId: unknown) =>
  (
    db.prepare('select project_id from registration_pages where id = ?').get(text(pageId)) as
      | { project_id: string }
      | undefined
  )?.project_id ?? null;

const fullName = (r: Row) => `${text(r.first_name)} ${text(r.last_name)}`.trim();
const inProject = () => canAccessProject('@pid');

// What goes into the trash: how it's named, which project it belongs to,
// and who may see and restore it (an SQL predicate; @pid is the project).
const TRASHABLE: Record<string, { label: (r: Row) => string; project: (r: Row) => string | null; may: () => string }> = {
  projects: { label: (r) => text(r.name), project: (r) => text(r.id), may: canManageProjects },
  events: { label: (r) => text(r.name), project: (r) => text(r.project_id), may: inProject },
  members: { label: fullName, project: (r) => text(r.project_id), may: inProject },
  project_groups: { label: (r) => text(r.name), project: (r) => text(r.project_id), may: inProject },
  forms: { label: (r) => text(r.title), project: (r) => text(r.project_id), may: inProject },
  concerts: { label: (r) => text(r.title), project: (r) => text(r.project_id), may: inProject },
  registration_pages: { label: (r) => text(r.title), project: (r) => text(r.project_id), may: inProject },
  registrations: { label: fullName, project: (r) => projectOfPage(r.registration_page_id), may: inProject },
  absence_labels: { label: (r) => text(r.name), project: (r) => text(r.project_id), may: inProject },
  pieces: { label: (r) => text(r.name), project: () => null, may: hasFullPieceAccess },
  calendars: { label: (r) => text(r.name), project: () => null, may: canEditCalendars },
};

export const isTrashable = (table: string) => Object.hasOwn(TRASHABLE, table);

// Rows that go with a deletion but are not worth keeping.
const NOT_KEPT = new Set(['notifications', 'notification_queue', 'trash', 'trash_rows', 'trash_values']);

// ---------------------------------------------------------------------------
// Schema: foreign keys (who references whom), keys and writable columns.
// Read once; migrations only run at start-up.
// ---------------------------------------------------------------------------

interface ForeignKey {
  child: string;
  from: string;
  parent: string;
  to: string;
  onDelete: string;
}

interface TableInfo {
  pk: string[];
  columns: Set<string>;
  // The table's own foreign keys.
  references: ForeignKey[];
}

let schema: { tables: Map<string, TableInfo>; children: Map<string, ForeignKey[]> } | null = null;

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

const loadSchema = () => {
  const tables = new Map<string, TableInfo>();
  const children = new Map<string, ForeignKey[]>();
  const names = (
    db.prepare(`select name from sqlite_master where type = 'table' and name not like 'sqlite_%'`).all() as {
      name: string;
    }[]
  ).map((r) => r.name);
  for (const name of names) {
    const cols = db.prepare('select name, pk, hidden from pragma_table_xinfo(?)').all(name) as {
      name: string;
      pk: number;
      hidden: number;
    }[];
    tables.set(name, {
      pk: cols
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name),
      // Generated columns can't be written.
      columns: new Set(cols.filter((c) => c.hidden === 0).map((c) => c.name)),
      references: [],
    });
  }
  for (const name of names) {
    const fks = db
      .prepare('select "table" as parent, "from" as source, "to" as target, on_delete from pragma_foreign_key_list(?)')
      .all(name) as { parent: string; source: string; target: string | null; on_delete: string }[];
    for (const fk of fks) {
      const entry: ForeignKey = {
        child: name,
        from: fk.source,
        parent: fk.parent,
        to: fk.target ?? tables.get(fk.parent)?.pk[0] ?? 'rowid',
        onDelete: fk.on_delete.toUpperCase(),
      };
      tables.get(name)?.references.push(entry);
      children.set(fk.parent, [...(children.get(fk.parent) ?? []), entry]);
    }
  }
  return { tables, children };
};

const info = () => (schema ??= loadSchema());

// Tables without a declared key are told apart by their rowid.
const selectAll = (table: string) => (info().tables.get(table)?.pk.length ? '*' : 'rowid as __rowid, *');

const keyOf = (table: string, row: Row): Row => {
  const pk = info().tables.get(table)?.pk ?? [];
  return pk.length ? Object.fromEntries(pk.map((c) => [c, row[c]])) : { rowid: row.__rowid };
};

// ---------------------------------------------------------------------------
// Taking the snapshot
// ---------------------------------------------------------------------------

interface Snapshot {
  rows: { table: string; data: Row }[];
  values: { table: string; key: Row; column: string; value: unknown }[];
  contents: Record<string, number>;
}

// What triggers clear beyond the foreign keys (migrations 0005, 0013): a
// deleted group's name on its members and as the project's default group.
const sideEffects = (table: string, rows: Row[], out: Snapshot) => {
  if (table !== 'project_groups') return;
  for (const group of rows) {
    const members = db
      .prepare('select id, group_name from members where project_id = ? and ulower(group_name) = ulower(?)')
      .all(group.project_id, group.name) as Row[];
    for (const m of members) {
      out.values.push({ table: 'members', key: { id: m.id }, column: 'group_name', value: m.group_name });
    }
    const project = db
      .prepare('select id, default_group from projects where id = ? and ulower(default_group) = ulower(?)')
      .get(group.project_id, group.name) as Row | undefined;
    if (project) {
      out.values.push({ table: 'projects', key: { id: project.id }, column: 'default_group', value: project.default_group });
    }
  }
};

const snapshotOf = (table: string, root: Row): Snapshot => {
  const out: Snapshot = { rows: [], values: [], contents: {} };
  const seen = new Map<string, Set<string>>();

  const visit = (t: string, rows: Row[]) => {
    const known = seen.get(t) ?? new Set<string>();
    seen.set(t, known);
    const fresh = rows.filter((r) => {
      const key = JSON.stringify(keyOf(t, r));
      if (known.has(key)) return false;
      known.add(key);
      return true;
    });
    if (fresh.length === 0) return;
    for (const data of fresh) out.rows.push({ table: t, data });
    out.contents[t] = (out.contents[t] ?? 0) + fresh.length;
    sideEffects(t, fresh, out);
    for (const fk of info().children.get(t) ?? []) {
      if (NOT_KEPT.has(fk.child)) continue;
      const parentValues = [...new Set(fresh.map((r) => r[fk.to]).filter((v) => v != null))];
      if (parentValues.length === 0) continue;
      const children = db
        .prepare(
          `select ${selectAll(fk.child)} from ${quote(fk.child)}
           where ${quote(fk.from)} in (select value from json_each(?))`,
        )
        .all(JSON.stringify(parentValues)) as Row[];
      if (children.length === 0) continue;
      if (fk.onDelete === 'CASCADE') {
        visit(fk.child, children);
      } else if (fk.onDelete === 'SET NULL' || fk.onDelete === 'SET DEFAULT') {
        for (const child of children) {
          out.values.push({ table: fk.child, key: keyOf(fk.child, child), column: fk.from, value: child[fk.from] });
        }
      }
    }
  };

  visit(table, [root]);
  return out;
};

// Called by rest.ts inside the deleting transaction, before the rows go:
// one entry per deleted row.
export const moveToTrash = (table: string, rowids: number[]) => {
  const kind = TRASHABLE[table];
  if (!kind || rowids.length === 0) return;
  const uid = authUid();
  const actor = uid
    ? (db.prepare('select name, email from app_users where id = ?').get(uid) as { name: string; email: string } | undefined)
    : undefined;
  const expires = new Date(Date.now() + RETENTION_DAYS * DAY).toISOString();
  const insertEntry = db.prepare(
    `insert into trash (id, kind, root_id, project_id, project_name, label, contents, deleted_by, deleted_by_name, expires_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertRow = db.prepare('insert into trash_rows (trash_id, seq, table_name, data) values (?, ?, ?, ?)');
  const insertValue = db.prepare(
    'insert into trash_values (trash_id, table_name, row_key, column_name, value) values (?, ?, ?, ?, ?)',
  );
  for (const rowid of rowids) {
    const root = db.prepare(`select ${selectAll(table)} from ${quote(table)} where rowid = ?`).get(rowid) as
      | Row
      | undefined;
    if (!root) continue;
    const snapshot = snapshotOf(table, root);
    const projectId = kind.project(root);
    const projectName =
      table === 'projects'
        ? text(root.name)
        : projectId
          ? ((db.prepare('select name from projects where id = ?').get(projectId) as { name: string } | undefined)
              ?.name ?? null)
          : null;
    const id = uuid();
    // What went with it, without itself.
    const contents = { ...snapshot.contents, [table]: (snapshot.contents[table] ?? 1) - 1 };
    insertEntry.run(
      id,
      table,
      text(root.id),
      projectId,
      projectName,
      kind.label(root) || '—',
      JSON.stringify(contents),
      uid,
      actor ? actor.name || actor.email : null,
      expires,
    );
    snapshot.rows.forEach((row, seq) => insertRow.run(id, seq, row.table, JSON.stringify(row.data)));
    for (const v of snapshot.values) {
      insertValue.run(id, v.table, JSON.stringify(v.key), v.column, JSON.stringify(v.value ?? null));
    }
  }
};

// ---------------------------------------------------------------------------
// Restoring
// ---------------------------------------------------------------------------

interface Entry {
  id: string;
  kind: string;
  root_id: string;
  project_id: string | null;
  project_name: string | null;
  label: string;
  contents: string;
  deleted_by_name: string | null;
  deleted_at: string;
  expires_at: string;
}

const whereKey = (key: Row) => {
  const columns = Object.keys(key);
  return {
    sql: columns.map((c) => `${c === 'rowid' ? 'rowid' : quote(c)} is ?`).join(' and '),
    params: columns.map((c) => key[c]),
  };
};

// Rows whose parent went away meanwhile (an account deleted, the
// registration page of a registration): links that may be empty are
// cleared, rows that would have been deleted with their parent stay
// deleted. Anything else is a conflict.
const settleForeignKeys = (tables: Set<string>) => {
  for (let round = 0; round < 6; round++) {
    let changed = false;
    for (const table of tables) {
      for (const fk of info().tables.get(table)?.references ?? []) {
        const orphan = `${quote(fk.from)} is not null and not exists (
          select 1 from ${quote(fk.parent)} _p where _p.${quote(fk.to)} = ${quote(table)}.${quote(fk.from)})`;
        const { n } = db.prepare(`select count(*) as n from ${quote(table)} where ${orphan}`).get() as { n: number };
        if (!n) continue;
        if (fk.onDelete === 'SET NULL') {
          db.prepare(`update ${quote(table)} set ${quote(fk.from)} = null where ${orphan}`).run();
        } else if (fk.onDelete === 'CASCADE') {
          db.prepare(`delete from ${quote(table)} where ${orphan}`).run();
        } else {
          throw new ApiError('This can no longer be restored', 409, 'trash_conflict');
        }
        changed = true;
      }
    }
    if (!changed) return;
  }
};

const restoreEntry = (entry: Entry) => {
  const queueBefore = (db.prepare('select coalesce(max(id), 0) as n from notification_queue').get() as { n: number }).n;
  // Rows that point at each other (a piece and its score file) go in in any
  // order; the keys are checked when the transaction ends.
  db.pragma('defer_foreign_keys = ON');
  // The deleted row first, then groups (inserting a member creates its
  // group if missing, see migration 0005), then everything else in order.
  const priority = (table: string) => (table === entry.kind ? 0 : table === 'project_groups' ? 1 : 2);
  const rows = (
    db.prepare('select seq, table_name, data from trash_rows where trash_id = ? order by seq').all(entry.id) as {
      seq: number;
      table_name: string;
      data: string;
    }[]
  ).sort((a, b) => priority(a.table_name) - priority(b.table_name) || a.seq - b.seq);
  const tables = new Set<string>();
  const restored: { table: string; data: Row; columns: string[] }[] = [];
  for (const row of rows) {
    const table = info().tables.get(row.table_name);
    if (!table) continue; // a table that no longer exists
    const data = JSON.parse(row.data) as Row;
    const columns = Object.keys(data).filter((c) => table.columns.has(c));
    restored.push({ table: row.table_name, data, columns });
    try {
      db.prepare(
        `insert into ${quote(row.table_name)} (${columns.map(quote).join(', ')})
         values (${columns.map(() => '?').join(', ')})`,
      ).run(...columns.map((c) => data[c] as never));
    } catch (err) {
      if ((err as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT')) {
        console.warn(`Trash restore of ${entry.kind} ${entry.root_id}: ${row.table_name}: ${(err as Error).message}`);
        throw new ApiError('Something with the same name or place exists again', 409, 'trash_conflict');
      }
      throw err;
    }
    tables.add(row.table_name);
  }
  // Insert triggers fill in defaults (a member's default group, photo or
  // account): every restored row gets exactly its old values back.
  for (const r of restored) {
    const key = whereKey(keyOf(r.table, r.data));
    const pk = info().tables.get(r.table)?.pk ?? [];
    const columns = r.columns.filter((c) => !pk.includes(c));
    if (!pk.length || columns.length === 0) continue;
    db.prepare(`update ${quote(r.table)} set ${columns.map((c) => `${quote(c)} = ?`).join(', ')} where ${key.sql}`).run(
      ...columns.map((c) => r.data[c] as never),
      ...(key.params as never[]),
    );
  }
  const values = db
    .prepare('select table_name, row_key, column_name, value from trash_values where trash_id = ?')
    .all(entry.id) as { table_name: string; row_key: string; column_name: string; value: string }[];
  for (const v of values) {
    if (!info().tables.get(v.table_name)?.columns.has(v.column_name)) continue;
    const key = whereKey(JSON.parse(v.row_key) as Row);
    db.prepare(
      `update ${quote(v.table_name)} set ${quote(v.column_name)} = ? where ${key.sql} and ${quote(v.column_name)} is null`,
    ).run(JSON.parse(v.value) as never, ...(key.params as never[]));
  }
  settleForeignKeys(tables);
  if (!db.prepare(`select 1 from ${quote(entry.kind)} where id = ?`).get(entry.root_id)) {
    throw new ApiError('What it belonged to is gone', 409, 'trash_parent_missing');
  }
  db.prepare('delete from trash where id = ?').run(entry.id);
  // Putting things back is no news (no "new Probe", "added to a project").
  db.prepare('delete from notification_queue where id > ?').run(queueBefore);
};

// ---------------------------------------------------------------------------
// Server functions
// ---------------------------------------------------------------------------

const requireUser = () => {
  const uid = authUid();
  if (!uid) throw new ApiError('Authentication required', 401, '42501');
  return uid;
};

const allowed = (entry: Pick<Entry, 'kind' | 'project_id'>) => {
  const kind = TRASHABLE[entry.kind];
  if (!kind) return false;
  const sql = kind.may();
  const statement = db.prepare(`select (${sql}) as v`);
  const row = (sql.includes('@pid') ? statement.get({ pid: entry.project_id }) : statement.get()) as { v: number };
  return Boolean(row.v);
};

// A project's entries wait for it while the project is in the trash itself.
const projectExists = (entry: Entry) =>
  entry.kind === 'projects' ||
  !entry.project_id ||
  Boolean(db.prepare('select 1 from projects where id = ?').get(entry.project_id));

const visibleEntries = (projectId: string | null) => {
  const rows = (
    projectId
      ? db.prepare(`select * from trash where project_id = ? and kind <> 'projects' order by deleted_at desc`).all(projectId)
      : db.prepare('select * from trash order by deleted_at desc').all()
  ) as Entry[];
  return rows.filter((e) => allowed(e) && projectExists(e));
};

const view = (e: Entry) => ({
  id: e.id,
  kind: e.kind,
  label: e.label,
  project_id: e.project_id,
  project_name: e.project_name,
  contents: JSON.parse(e.contents) as Record<string, number>,
  deleted_by_name: e.deleted_by_name,
  deleted_at: e.deleted_at,
  expires_at: e.expires_at,
});

// The caller's trash: one project's entries, or everything they may restore.
const trash_list = (args: Args) => {
  requireUser();
  return visibleEntries(text(args.p_project_id) || null).map(view);
};

// Entries the caller may restore (one project's, or all); for the sidebars.
export const trashCount = (projectId: string | null) => visibleEntries(projectId).length;

const trash_count = (args: Args) => {
  requireUser();
  return trashCount(text(args.p_project_id) || null);
};

const entryFor = (id: unknown) => {
  requireUser();
  const entry = db.prepare('select * from trash where id = ?').get(text(id)) as Entry | undefined;
  if (!entry || !allowed(entry)) throw new ApiError('Not found', 404, 'trash_not_found');
  return entry;
};

const trash_restore = (args: Args) => {
  const entry = entryFor(args.p_id);
  if (!projectExists(entry)) throw new ApiError('Restore the project first', 409, 'trash_parent_missing');
  restoreEntry(entry);
  return { kind: entry.kind, id: entry.root_id, project_id: entry.project_id };
};

// Gone for good (its files go with the next maintenance run).
const trash_purge = (args: Args) => {
  const entry = entryFor(args.p_id);
  db.prepare('delete from trash where id = ?').run(entry.id);
  // Only trash rows change, which the audit log skips: say what went.
  auditNote({ force: true, details: { kind: entry.kind, label: entry.label } });
  return { ok: true };
};

const trash_empty = (args: Args) => {
  requireUser();
  const entries = visibleEntries(text(args.p_project_id) || null);
  const remove = db.prepare('delete from trash where id = ?');
  for (const e of entries) remove.run(e.id);
  if (entries.length) auditNote({ force: true, details: { removed: entries.length } });
  return { removed: entries.length };
};

export const TRASH_READ_FUNCTIONS = ['trash_list', 'trash_count'];
export const trashFunctions = { trash_list, trash_count, trash_restore, trash_purge, trash_empty };

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

export const purgeExpiredTrash = () => {
  const { changes } = db.prepare('delete from trash where expires_at < ?').run(nowIso());
  if (changes) console.log(`Trash: ${changes} expired entries removed`);
};

export const startTrashJobs = () => {
  setTimeout(purgeExpiredTrash, 60_000).unref();
  setInterval(purgeExpiredTrash, 6 * 60 * 60 * 1000).unref();
};
