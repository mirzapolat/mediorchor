// A concert's recordings beyond plain table access: the trash (deleted
// recordings wait 30 days, as a piece's files), who may read a stored
// object, and the maintenance job that marks missing objects and removes
// ones nothing points at. Recordings are never public: every read needs a
// session and access to the concert.
import type { Context } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { db, asUser, authUid, ApiError, forbidden } from './db.ts';
import { env } from './env.ts';
import { sessionUser } from './auth.ts';
import { bucketObjectPath, concertInManagedProject, concertVisible, isCanonicalKey } from './policies.ts';

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

const TRASH_DAYS = 30;
const bucketDir = () => path.join(env.storageDir, 'concert-files');

const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const ids = (value: unknown): string[] => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);

const holds = (sql: string, ...params: unknown[]) =>
  Boolean((db.prepare(`select (${sql}) as v`).get(...params) as { v: number }).v);

const requireConcertManager = (concertId: string) => {
  if (!authUid()) throw new ApiError('Authentication required', 401, '42501');
  if (!concertId || !holds(concertInManagedProject('?'), concertId)) throw forbidden('Access denied');
};

const userName = () =>
  (db.prepare('select name from app_users where id = ?').get(authUid()) as { name: string } | undefined)?.name ?? '';

// Whether the caller may upload to (or delete from) a concert's folder.
export const canWriteConcertObject = (key: string) => {
  const concertId = key.split('/')[0];
  return Boolean(concertId) && holds(concertInManagedProject('?'), concertId);
};

// Moves recordings to the concert's trash: the row goes, the stored object
// stays until the trash is emptied.
const trash_concert_recordings = (args: Args) => {
  const deletedBy = userName();
  const out: string[] = [];
  for (const id of ids(args.p_ids)) {
    const row = db.prepare('select * from concert_recordings where id = ?').get(id) as Row | undefined;
    if (!row) continue;
    requireConcertManager(text(row.concert_id));
    const { id: trashId } = db
      .prepare(
        'insert into concert_recording_trash (concert_id, recording_id, row, deleted_by_name) values (?, ?, ?, ?) returning id',
      )
      .get(row.concert_id, id, JSON.stringify(row), deletedBy) as { id: string };
    db.prepare('delete from concert_recordings where id = ?').run(id);
    out.push(trashId);
  }
  return out;
};

// Puts recordings back (for the whole concert when their programme item is
// gone).
const restore_concert_recordings = (args: Args) => {
  const columns = new Set(
    (db.prepare('select name from pragma_table_info(?)').all('concert_recordings') as { name: string }[]).map((c) => c.name),
  );
  const restored: string[] = [];
  for (const trashId of ids(args.p_ids)) {
    const entry = db.prepare('select * from concert_recording_trash where id = ?').get(trashId) as Row | undefined;
    if (!entry) continue;
    requireConcertManager(text(entry.concert_id));
    const row = JSON.parse(text(entry.row)) as Row;
    if (!db.prepare('select 1 from concert_recordings where id = ?').get(row.id)) {
      if (row.item_id != null && !db.prepare('select 1 from concert_program_items where id = ?').get(row.item_id)) {
        row.item_id = null;
      }
      const keys = Object.keys(row).filter((k) => columns.has(k));
      db.prepare(`insert into concert_recordings (${keys.join(', ')}) values (${keys.map(() => '?').join(', ')})`).run(
        ...keys.map((k) => row[k] as string | number | null),
      );
      restored.push(text(row.id));
    }
    db.prepare('delete from concert_recording_trash where id = ?').run(trashId);
  }
  return restored;
};

const removeObjects = (keys: string[]) => {
  for (const key of keys) {
    const file = bucketObjectPath('concert-files', key);
    if (!file) continue;
    try {
      fs.unlinkSync(file);
    } catch {
      /* already gone */
    }
  }
};

// Deletes trash rows; returns the stored objects no live recording uses.
const purgeTrashRows = (entries: Row[]) => {
  const keys: string[] = [];
  for (const entry of entries) {
    db.prepare('delete from concert_recording_trash where id = ?').run(entry.id);
    const key = (JSON.parse(text(entry.row)) as Row).file_path;
    if (typeof key === 'string' && !db.prepare('select 1 from concert_recordings where file_path = ?').get(key)) {
      keys.push(key);
    }
  }
  return keys;
};

// Deletes trashed recordings for good (after an explicit confirmation).
const purge_concert_recordings = (args: Args) => {
  const entries: Row[] = [];
  for (const trashId of ids(args.p_ids)) {
    const entry = db.prepare('select * from concert_recording_trash where id = ?').get(trashId) as Row | undefined;
    if (!entry) continue;
    requireConcertManager(text(entry.concert_id));
    entries.push(entry);
  }
  const keys = purgeTrashRows(entries);
  // After the transaction: a failed write keeps the objects.
  setImmediate(() => removeObjects(keys));
  return { purged: entries.length };
};

export const concertFunctions = {
  trash_concert_recordings,
  restore_concert_recordings,
  purge_concert_recordings,
};

// Whether this request may read a stored recording: those who manage the
// project (also trashed ones), participants while the concert is published
// and the recording live. Anything else (and every unknown key) is refused.
export const mayReadConcertObject = (c: Context, key: string) => {
  if (!isCanonicalKey(key)) return false;
  const user = sessionUser(c);
  if (!user) return false;
  return asUser(user.id, () => {
    const live = db
      .prepare(`select 1 from concert_recordings r where r.file_path = ? and ${concertVisible('r.concert_id')} limit 1`)
      .get(key);
    if (live) return true;
    const trashed = db
      .prepare(
        `select 1 from concert_recording_trash t where json_extract(t.row, '$.file_path') = ?
           and ${concertInManagedProject('t.concert_id')} limit 1`,
      )
      .get(key);
    return Boolean(trashed);
  });
};

// Keeps rows and stored objects in step: trashed recordings older than 30
// days go, rows whose object is missing are marked, and objects nothing
// points at (failed uploads, deleted concerts) are removed after a day.
export const runConcertFileMaintenance = () => {
  const cutoff = new Date(Date.now() - TRASH_DAYS * 24 * 3600 * 1000).toISOString();
  const old = db.prepare('select * from concert_recording_trash where deleted_at < ?').all(cutoff) as Row[];
  removeObjects(db.transaction(() => purgeTrashRows(old))());

  const rows = db
    .prepare(`select id, file_path, file_missing from concert_recordings where kind = 'file'`)
    .all() as Array<{ id: string; file_path: string; file_missing: number }>;
  const mark = db.prepare('update concert_recordings set file_missing = ? where id = ?');
  let missing = 0;
  db.transaction(() => {
    for (const row of rows) {
      const file = bucketObjectPath('concert-files', row.file_path);
      const gone = !file || !fs.existsSync(file);
      if (gone) missing++;
      if (Number(gone) !== row.file_missing) mark.run(gone ? 1 : 0, row.id);
    }
  })();

  const referenced = new Set(
    (
      db
        .prepare(
          `select file_path as key from concert_recordings where file_path is not null
           union select json_extract(row, '$.file_path') from concert_recording_trash`,
        )
        .all() as { key: string | null }[]
    )
      .map((r) => r.key)
      .filter(Boolean),
  );
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  let orphans = 0;
  let dirs: fs.Dirent[] = [];
  try {
    dirs = fs.readdirSync(bucketDir(), { withFileTypes: true });
  } catch {
    return { purged: old.length, missing, orphans };
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(bucketDir(), dir.name);
    for (const name of fs.readdirSync(dirPath)) {
      if (referenced.has(`${dir.name}/${name}`)) continue;
      const full = path.join(dirPath, name);
      try {
        if (fs.statSync(full).mtimeMs > dayAgo) continue;
        fs.unlinkSync(full);
        orphans++;
      } catch {
        /* gone meanwhile */
      }
    }
  }
  return { purged: old.length, missing, orphans };
};

export const startConcertFileMaintenance = () => {
  const run = () => {
    try {
      const r = runConcertFileMaintenance();
      if (r.purged || r.orphans || r.missing) {
        console.log(
          `Concert recordings: ${r.purged} purged from the trash, ${r.orphans} orphaned objects removed, ${r.missing} missing on disk`,
        );
      }
    } catch (err) {
      console.error('Concert recording maintenance failed', err);
    }
  };
  setTimeout(run, 3 * 60 * 1000).unref();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
};
