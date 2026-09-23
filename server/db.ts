// SQLite connection, migrations, the per-request user context and helpers for
// converting between SQLite storage and the JSON shapes the browser expects.
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.ts';

fs.mkdirSync(env.storageDir, { recursive: true });

export const db = new Database(env.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

export const uuid = () => randomUUID();
export const nowIso = () => new Date().toISOString();

// The user the current (synchronous) unit of work runs as. better-sqlite3 is
// synchronous, so setting it around a block of queries is race-free as long as
// the block never awaits. Policies read it through the auth_uid() SQL function.
let currentUid: string | null = null;

export const asUser = <T>(uid: string | null, fn: () => T): T => {
  const previous = currentUid;
  currentUid = uid;
  try {
    return fn();
  } finally {
    currentUid = previous;
  }
};

export const authUid = () => currentUid;

db.function('uuid', { deterministic: false }, () => uuid());
db.function('now_iso', { deterministic: false }, () => nowIso());
db.function('auth_uid', { deterministic: false }, () => currentUid);
// Unicode-aware lower(); SQLite's built-in only folds ASCII (Ö stays Ö).
db.function('ulower', { deterministic: true }, (value: unknown) =>
  typeof value === 'string' ? value.toLowerCase() : value,
);

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

const migrationsDir = path.join(import.meta.dirname, 'migrations');

export const migrate = () => {
  db.exec(`create table if not exists _migrations (
    name text primary key,
    applied_at text not null default (now_iso())
  )`);
  const applied = new Set(
    (db.prepare('select name from _migrations').all() as { name: string }[]).map((r) => r.name),
  );
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('insert into _migrations (name) values (?)').run(file);
    })();
    console.log(`Applied migration ${file}`);
  }
};

// ---------------------------------------------------------------------------
// Table metadata (introspected once after migrations)
// ---------------------------------------------------------------------------

export type ColumnKind = 'text' | 'integer' | 'boolean' | 'json';

export interface TableMeta {
  name: string;
  columns: Map<string, ColumnKind>;
  // Many-to-one relations: referenced table → local column / referenced column.
  foreignKeys: Map<string, { from: string; to: string }>;
}

const tableMeta = new Map<string, TableMeta>();

export const loadTableMeta = () => {
  tableMeta.clear();
  const tables = db
    .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
    .all() as { name: string }[];
  for (const { name } of tables) {
    const columns = new Map<string, ColumnKind>();
    for (const col of db.pragma(`table_info("${name}")`) as { name: string; type: string }[]) {
      const type = col.type.toLowerCase();
      columns.set(
        col.name,
        type === 'boolean' ? 'boolean' : type === 'json' ? 'json' : type === 'integer' ? 'integer' : 'text',
      );
    }
    const foreignKeys = new Map<string, { from: string; to: string }>();
    for (const fk of db.pragma(`foreign_key_list("${name}")`) as {
      table: string;
      from: string;
      to: string;
    }[]) {
      foreignKeys.set(fk.table, { from: fk.from, to: fk.to });
    }
    tableMeta.set(name, { name, columns, foreignKeys });
  }
};

export const getTableMeta = (name: string): TableMeta | undefined => tableMeta.get(name);

// SQLite row → JSON row (0/1 → booleans, JSON text → values).
export const decodeRow = (meta: TableMeta, row: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const kind = meta.columns.get(key);
    if (value === null || value === undefined) out[key] = null;
    else if (kind === 'boolean') out[key] = Boolean(value);
    else if (kind === 'json') out[key] = typeof value === 'string' ? JSON.parse(value) : value;
    else out[key] = value;
  }
  return out;
};

// JSON value → SQLite parameter for a given column.
export const encodeValue = (kind: ColumnKind | undefined, value: unknown): unknown => {
  if (value === null || value === undefined) return null;
  if (kind === 'json') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
};

// Errors that are safe to show to the browser. `code` mirrors the Postgres
// error codes the Supabase API used to return.
export class ApiError extends Error {
  status: number;
  code: string | undefined;
  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const forbidden = (message = 'Permission denied') => new ApiError(message, 403, '42501');

// Maps SQLite constraint errors onto friendly API errors.
export const translateDbError = (err: unknown): ApiError => {
  if (err instanceof ApiError) return err;
  const e = err as { code?: string; message?: string };
  switch (e.code) {
    case 'SQLITE_CONSTRAINT_UNIQUE':
    case 'SQLITE_CONSTRAINT_PRIMARYKEY':
      return new ApiError('duplicate key value violates unique constraint', 409, '23505');
    case 'SQLITE_CONSTRAINT_FOREIGNKEY':
      return new ApiError('violates foreign key constraint', 409, '23503');
    case 'SQLITE_CONSTRAINT_NOTNULL':
      return new ApiError(e.message ?? 'null value violates not-null constraint', 400, '23502');
    case 'SQLITE_CONSTRAINT_CHECK':
      return new ApiError(e.message ?? 'violates check constraint', 400, '23514');
    default:
      console.error(err);
      return new ApiError('Internal server error', 500);
  }
};
