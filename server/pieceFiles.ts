// A piece's "Dateien" beyond plain table access: moving and ordering in one
// write, the trash (deleted files wait 30 days), downloads as one ZIP built
// and streamed by the server, who may read a stored object, and the
// maintenance job that keeps rows and stored objects in step.
import { Hono, type Context } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { db, asUser, authUid, ApiError, forbidden } from './db.ts';
import { env } from './env.ts';
import { requireSession, sessionUser } from './auth.ts';
import {
  canEditPiece,
  canReadPieceFile,
  canSeePiece,
  fileIsPublic,
  folderIsPublic,
  folderWithin,
  isCanonicalKey,
  pieceObjectPath,
} from './policies.ts';

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

const bucketDir = () => path.join(env.storageDir, 'piece-files');
const TRASH_DAYS = 30;

const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const ids = (value: unknown): string[] => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);

const requireUser = () => {
  const uid = authUid();
  if (!uid) throw new ApiError('Authentication required', 401, '42501');
  return uid;
};

const holds = (sql: string, ...params: unknown[]) =>
  Boolean((db.prepare(`select (${sql}) as v`).get(...params) as { v: number }).v);
const mayEdit = (pieceId: string) => holds(canEditPiece('?'), pieceId);

const requireEditor = (pieceId: string) => {
  requireUser();
  if (!pieceId || !mayEdit(pieceId)) throw forbidden('Access denied');
};

const userName = () =>
  (db.prepare('select name from app_users where id = ?').get(authUid()) as { name: string } | undefined)?.name ?? '';

// Where the piece uses a file: its own fields and its voices' recordings.
const PIECE_FILE_FIELDS = ['score_file_id', 'notation_file_id', 'timing_file_id', 'trainer_file_id'] as const;
const TRACK_FILE_FIELDS = ['file_id', 'click_file_id', 'quiet_file_id', 'quiet_click_file_id'] as const;

// ---------------------------------------------------------------------------
// Moving and ordering
// ---------------------------------------------------------------------------

// Sets where folders and files sit (parent, position) all at once: one
// refused change leaves everything as it was. Used for moves, reordering and
// undoing them.
const arrange_piece_files = (args: Args) => {
  const pieceId = text(args.p_piece_id);
  requireEditor(pieceId);
  const folders = (Array.isArray(args.p_folders) ? args.p_folders : []) as Row[];
  const files = (Array.isArray(args.p_files) ? args.p_files : []) as Row[];
  const ofPiece = (table: string, id: unknown) =>
    id == null || Boolean(db.prepare(`select 1 from ${table} where id = ? and piece_id = ?`).get(text(id), pieceId));

  for (const f of folders) {
    const parent = f.parent_id == null ? null : text(f.parent_id);
    if (!ofPiece('piece_file_folders', f.id) || !ofPiece('piece_file_folders', parent) || parent === text(f.id)) {
      throw new ApiError('The folder is not part of this piece', 400, '23503');
    }
    db.prepare('update piece_file_folders set parent_id = ?, position = ? where id = ?').run(
      parent,
      Math.trunc(Number(f.position) || 0),
      text(f.id),
    );
  }
  for (const f of files) {
    const folder = f.folder_id == null ? null : text(f.folder_id);
    if (!ofPiece('piece_files', f.id) || !ofPiece('piece_file_folders', folder)) {
      throw new ApiError('The file is not part of this piece', 400, '23503');
    }
    db.prepare('update piece_files set folder_id = ?, position = ? where id = ?').run(
      folder,
      Math.trunc(Number(f.position) || 0),
      text(f.id),
    );
  }
  // No folder ended up inside itself.
  for (const f of folders) {
    if (f.parent_id != null && folderWithin(text(f.parent_id), text(f.id))) {
      throw new ApiError('A folder cannot move into itself', 400, '23514');
    }
  }
  return { ok: true };
};

// ---------------------------------------------------------------------------
// Trash
// ---------------------------------------------------------------------------

// Moves files to the piece's trash: the row goes (voices and the piece lose
// it, as with a delete), the stored object stays until it is purged.
const trash_piece_files = (args: Args) => {
  requireUser();
  const deletedBy = userName();
  const out: Array<{ trash_id: string; file_id: string }> = [];
  for (const fileId of ids(args.p_ids)) {
    const row = db.prepare('select * from piece_files where id = ?').get(fileId) as Row | undefined;
    if (!row) continue;
    requireEditor(text(row.piece_id));
    const pieceFields = PIECE_FILE_FIELDS.filter((field) =>
      db.prepare(`select 1 from pieces where id = ? and ${field} = ?`).get(row.piece_id, fileId),
    );
    const tracks = TRACK_FILE_FIELDS.flatMap((field) =>
      (db.prepare(`select id from piece_tracks where ${field} = ?`).all(fileId) as { id: string }[]).map((t) => ({
        id: t.id,
        field,
      })),
    );
    const { id } = db
      .prepare(
        'insert into piece_file_trash (piece_id, file_id, row, links, deleted_by_name) values (?, ?, ?, ?, ?) returning id',
      )
      .get(row.piece_id, fileId, JSON.stringify(row), JSON.stringify({ piece: pieceFields, tracks }), deletedBy) as {
      id: string;
    };
    db.prepare('delete from piece_files where id = ?').run(fileId);
    out.push({ trash_id: id, file_id: fileId });
  }
  return out;
};

// Puts trashed files back: where they were (the top if their folder is
// gone) and, where nothing took their place, as the piece's score, a voice's
// recording, … again.
const restore_piece_files = (args: Args) => {
  requireUser();
  const columns = new Set(
    (db.prepare('select name from pragma_table_info(?)').all('piece_files') as { name: string }[]).map((c) => c.name),
  );
  const restored: string[] = [];
  for (const trashId of ids(args.p_ids)) {
    const entry = db.prepare('select * from piece_file_trash where id = ?').get(trashId) as Row | undefined;
    if (!entry) continue;
    requireEditor(text(entry.piece_id));
    const row = JSON.parse(text(entry.row)) as Row;
    const links = JSON.parse(text(entry.links) || '{}') as {
      piece?: string[];
      tracks?: Array<{ id: string; field: string }>;
    };
    if (!db.prepare('select 1 from piece_files where id = ?').get(row.id)) {
      const folderKept =
        row.folder_id == null ||
        db.prepare('select 1 from piece_file_folders where id = ? and piece_id = ?').get(row.folder_id, entry.piece_id);
      if (!folderKept) row.folder_id = null;
      const keys = Object.keys(row).filter((k) => columns.has(k));
      db.prepare(`insert into piece_files (${keys.join(', ')}) values (${keys.map(() => '?').join(', ')})`).run(
        ...keys.map((k) => row[k] as string | number | null),
      );
      for (const field of links.piece ?? []) {
        if (!(PIECE_FILE_FIELDS as readonly string[]).includes(field)) continue;
        db.prepare(`update pieces set ${field} = ? where id = ? and ${field} is null`).run(row.id, entry.piece_id);
      }
      for (const link of links.tracks ?? []) {
        if (!(TRACK_FILE_FIELDS as readonly string[]).includes(link.field)) continue;
        db.prepare(
          `update piece_tracks set ${link.field} = ? where id = ? and piece_id = ? and ${link.field} is null`,
        ).run(row.id, link.id, entry.piece_id);
      }
      restored.push(text(row.id));
    }
    db.prepare('delete from piece_file_trash where id = ?').run(trashId);
  }
  return restored;
};

// Stored objects of a trashed row (its file, a link's image) that no live
// row uses.
const unusedObjects = (row: Row): string[] => {
  let image: unknown = null;
  try {
    image = (typeof row.link_preview === 'string' ? JSON.parse(row.link_preview) : row.link_preview)?.image ?? null;
  } catch {
    image = null;
  }
  return [row.file_path, image]
    .filter((key): key is string => typeof key === 'string' && key.length > 0)
    .filter(
      (key) =>
        !db
          .prepare(`select 1 from piece_files where file_path = ? or json_extract(link_preview, '$.image') = ?`)
          .get(key, key),
    );
};

const removeObjects = (keys: string[]) => {
  for (const key of keys) {
    const file = pieceObjectPath(key);
    if (!file) continue;
    try {
      fs.unlinkSync(file);
    } catch {
      /* already gone */
    }
  }
};

// Deletes trash rows; returns their objects to remove once that is stored.
const purgeTrashRows = (entries: Row[]) => {
  const keys: string[] = [];
  for (const entry of entries) {
    db.prepare('delete from piece_file_trash where id = ?').run(entry.id);
    keys.push(...unusedObjects(JSON.parse(text(entry.row)) as Row));
  }
  return keys;
};

// Deletes trashed files for good (now, instead of after 30 days).
const purge_piece_file_trash = (args: Args) => {
  requireUser();
  const entries: Row[] = [];
  for (const trashId of ids(args.p_ids)) {
    const entry = db.prepare('select * from piece_file_trash where id = ?').get(trashId) as Row | undefined;
    if (!entry) continue;
    requireEditor(text(entry.piece_id));
    entries.push(entry);
  }
  const keys = purgeTrashRows(entries);
  // After the transaction: a failed write keeps the objects.
  setImmediate(() => removeObjects(keys));
  return { purged: entries.length };
};

export const pieceFileFunctions = {
  arrange_piece_files,
  trash_piece_files,
  restore_piece_files,
  purge_piece_file_trash,
};

// ---------------------------------------------------------------------------
// Reading stored objects
// ---------------------------------------------------------------------------


// Whether this request may read a stored object of the piece-files bucket.
// Default deny: an object of a file row (or a link's preview image) follows
// who may read that row — private files only for the piece's editors; a
// trashed one is for editors; a score's preview image ("preview-<file>.jpg",
// shown in link previews of the piece) is public. Anything else is refused.
export const mayReadPieceObject = (c: Context, key: string): { allowed: boolean; guarded: boolean } => {
  // Only app-made keys are looked up, so the key checked is exactly the file
  // served (no "a//b", "a/./b", other casing or encoded slashes).
  if (!isCanonicalKey(key)) return { allowed: false, guarded: true };
  if (/^[^/]+\/preview-[a-z0-9-]+\.jpg$/.test(key)) return { allowed: true, guarded: false };
  const ofRow = `(t.file_path = @key or json_extract(t.link_preview, '$.image') = @key)`;
  const live = db.prepare(`select 1 from piece_files t where ${ofRow} limit 1`).get({ key });
  const trashed = db
    .prepare(
      `select piece_id from piece_file_trash
       where json_extract(row, '$.file_path') = @key or json_extract(json_extract(row, '$.link_preview'), '$.image') = @key
       limit 1`,
    )
    .get({ key }) as { piece_id: string } | undefined;
  if (!live && !trashed) return { allowed: false, guarded: true };
  const user = sessionUser(c);
  if (!user) return { allowed: false, guarded: true };
  const allowed = asUser(user.id, () => {
    if (live && db.prepare(`select 1 from piece_files t where ${ofRow} and ${canReadPieceFile('t')} limit 1`).get({ key })) {
      return true;
    }
    return Boolean(trashed && mayEdit(trashed.piece_id));
  });
  return { allowed, guarded: true };
};

// ---------------------------------------------------------------------------
// ZIP downloads
// ---------------------------------------------------------------------------

// Makes a string safe as a file name on all systems (as src/lib/zip.ts).
export const safeFileName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Datei';

const fileExt = (name: string) => /\.[a-z0-9]{1,8}$/i.exec(name)?.[0] ?? '';

interface ZipEntry {
  name: Buffer;
  file: string;
  size: number;
  offset: number;
  crc: number;
}

const MAX32 = 0xffffffff;

const dosDateTime = (d = new Date()) => ({
  time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
});

// Header sizes follow from the name and whether ZIP64 fields are needed, so
// the whole length is known before the first byte.
const localExtra = (e: Pick<ZipEntry, 'size'>) => (e.size >= MAX32 ? 20 : 0);
const centralExtra = (e: Pick<ZipEntry, 'size' | 'offset'>) => {
  const fields = (e.size >= MAX32 ? 2 : 0) + (e.offset >= MAX32 ? 1 : 0);
  return fields ? 4 + fields * 8 : 0;
};

const localHeader = (e: ZipEntry, stamp: { time: number; date: number }) => {
  const zip64 = e.size >= MAX32;
  const b = Buffer.alloc(30 + e.name.length + localExtra(e));
  b.writeUInt32LE(0x04034b50, 0);
  b.writeUInt16LE(zip64 ? 45 : 20, 4);
  b.writeUInt16LE(0x0800, 6); // UTF-8 names
  b.writeUInt16LE(0, 8); // stored
  b.writeUInt16LE(stamp.time, 10);
  b.writeUInt16LE(stamp.date, 12);
  b.writeUInt32LE(e.crc, 14);
  b.writeUInt32LE(zip64 ? MAX32 : e.size, 18);
  b.writeUInt32LE(zip64 ? MAX32 : e.size, 22);
  b.writeUInt16LE(e.name.length, 26);
  b.writeUInt16LE(localExtra(e), 28);
  e.name.copy(b, 30);
  if (zip64) {
    const at = 30 + e.name.length;
    b.writeUInt16LE(0x0001, at);
    b.writeUInt16LE(16, at + 2);
    b.writeBigUInt64LE(BigInt(e.size), at + 4);
    b.writeBigUInt64LE(BigInt(e.size), at + 12);
  }
  return b;
};

const centralHeader = (e: ZipEntry, stamp: { time: number; date: number }) => {
  const bigSize = e.size >= MAX32;
  const bigOffset = e.offset >= MAX32;
  const extra = centralExtra(e);
  const b = Buffer.alloc(46 + e.name.length + extra);
  b.writeUInt32LE(0x02014b50, 0);
  b.writeUInt16LE(45, 4);
  b.writeUInt16LE(extra ? 45 : 20, 6);
  b.writeUInt16LE(0x0800, 8);
  b.writeUInt16LE(0, 10);
  b.writeUInt16LE(stamp.time, 12);
  b.writeUInt16LE(stamp.date, 14);
  b.writeUInt32LE(e.crc, 16);
  b.writeUInt32LE(bigSize ? MAX32 : e.size, 20);
  b.writeUInt32LE(bigSize ? MAX32 : e.size, 24);
  b.writeUInt16LE(e.name.length, 28);
  b.writeUInt16LE(extra, 30);
  b.writeUInt32LE(bigOffset ? MAX32 : e.offset, 42);
  e.name.copy(b, 46);
  if (extra) {
    let at = 46 + e.name.length;
    b.writeUInt16LE(0x0001, at);
    b.writeUInt16LE(extra - 4, at + 2);
    at += 4;
    if (bigSize) {
      b.writeBigUInt64LE(BigInt(e.size), at);
      b.writeBigUInt64LE(BigInt(e.size), at + 8);
      at += 16;
    }
    if (bigOffset) b.writeBigUInt64LE(BigInt(e.offset), at);
  }
  return b;
};

const endRecords = (count: number, cdOffset: number, cdSize: number) => {
  const zip64 = count >= 0xffff || cdOffset >= MAX32 || cdSize >= MAX32;
  const parts: Buffer[] = [];
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(count), 24);
    record.writeBigUInt64LE(BigInt(count), 32);
    record.writeBigUInt64LE(BigInt(cdSize), 40);
    record.writeBigUInt64LE(BigInt(cdOffset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(cdOffset + cdSize), 8);
    locator.writeUInt32LE(1, 16);
    parts.push(record, locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Math.min(count, 0xffff), 8);
  end.writeUInt16LE(Math.min(count, 0xffff), 10);
  end.writeUInt32LE(Math.min(cdSize, MAX32), 12);
  end.writeUInt32LE(Math.min(cdOffset, MAX32), 16);
  parts.push(end);
  return parts;
};

const crcOf = async (file: string) => {
  let crc = 0;
  for await (const chunk of fs.createReadStream(file)) crc = zlib.crc32(chunk as Buffer, crc);
  return crc;
};

// What a ZIP request takes: the files one may download (editors: all;
// others: public ones), with their paths inside the ZIP. A folder (or the
// whole piece) comes with everything in it; a selection keeps each chosen
// folder as a folder.
const zipEntries = (pieceId: string, query: { folder?: string; folders?: string[]; files?: string[] }) => {
  const editor = mayEdit(pieceId);
  const files = db
    .prepare(
      `select t.*, (${fileIsPublic('t')}) as is_public from piece_files t
       where t.piece_id = ? and ${canReadPieceFile('t')} order by t.position, t.created_at`,
    )
    .all(pieceId) as Row[];
  const folders = db
    .prepare(
      `select d.* from piece_file_folders d where d.piece_id = ?
       and (${editor ? '1' : folderIsPublic('d.id')}) order by d.position, d.created_at`,
    )
    .all(pieceId) as Row[];
  const known = new Set(folders.map((d) => text(d.id)));
  const parentOf = (d: Row) => (d.parent_id && known.has(text(d.parent_id)) ? text(d.parent_id) : null);
  const folderOf = (f: Row) => (f.folder_id && known.has(text(f.folder_id)) ? text(f.folder_id) : null);
  const downloadable = (f: Row) => f.kind !== 'link' && Boolean(f.file_path) && (editor || Boolean(f.is_public));
  const entryName = (f: Row) => {
    const title = text(f.title).trim();
    return title ? safeFileName(title) + fileExt(text(f.file_name)) : safeFileName(text(f.file_name));
  };

  const out: Array<{ name: string; key: string }> = [];
  const seen = new Set<string>();
  const walk = (folderId: string | null, prefix: string) => {
    if (folderId) {
      if (seen.has(folderId)) return;
      seen.add(folderId);
    }
    for (const f of files) {
      if (folderOf(f) === folderId && downloadable(f)) out.push({ name: prefix + entryName(f), key: text(f.file_path) });
    }
    for (const d of folders) if (parentOf(d) === folderId) walk(text(d.id), `${prefix}${safeFileName(text(d.name))}/`);
  };

  if (query.folders?.length || query.files?.length) {
    for (const id of query.files ?? []) {
      const f = files.find((x) => x.id === id);
      if (f && downloadable(f)) out.push({ name: entryName(f), key: text(f.file_path) });
    }
    for (const id of query.folders ?? []) {
      const d = folders.find((x) => x.id === id);
      if (d) walk(text(d.id), `${safeFileName(text(d.name))}/`);
    }
  } else {
    const folder = query.folder && known.has(query.folder) ? query.folder : null;
    if (query.folder && !folder) throw new ApiError('Folder not found', 404);
    walk(folder, '');
  }

  // One name per entry ("Name (2).pdf").
  const used = new Set<string>();
  return out.map((entry) => {
    let unique = entry.name;
    for (let n = 2; used.has(unique.toLowerCase()); n++) unique = entry.name.replace(/(\.[^./]+)?$/, ` (${n})$1`);
    used.add(unique.toLowerCase());
    return { ...entry, name: unique };
  });
};

const contentDisposition = (fileName: string) => {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
};

export const pieceZipRoutes = new Hono();

// GET /api/piece-zip/<pieceId>?folder=<id> | ?folders=a,b&files=x,y [&name=…]
// Streams a ZIP (stored, ZIP64 when large) whose length is known up front,
// so the browser shows real progress. Files missing on the server are left
// out.
pieceZipRoutes.get('/:pieceId', async (c) => {
  const user = requireSession(c);
  const pieceId = c.req.param('pieceId');
  const list = (v: string | undefined) => (v ? v.split(',').filter(Boolean).slice(0, 2000) : undefined);
  const picked = asUser(user.id, () => {
    const piece = db.prepare('select name from pieces where id = ?').get(pieceId) as { name: string } | undefined;
    if (!piece || !holds(canSeePiece('?'), pieceId)) throw new ApiError('Not found', 404);
    return {
      piece,
      entries: zipEntries(pieceId, {
        folder: c.req.query('folder') || undefined,
        folders: list(c.req.query('folders')),
        files: list(c.req.query('files')),
      }),
    };
  });

  const files = picked.entries
    .map((entry) => ({ name: entry.name, file: pieceObjectPath(entry.key) }))
    .filter((entry): entry is { name: string; file: string } => entry.file != null);
  return streamZip(files, safeFileName(c.req.query('name') || picked.piece.name));
});

// Streams a ZIP (stored, ZIP64 when large) of these files under these names;
// the length is known up front, so the browser shows real progress. Files
// missing on the server are left out; none at all is a 404.
export const streamZip = (files: Array<{ name: string; file: string }>, zipName: string) => {
  const stamp = dosDateTime();
  const entries: ZipEntry[] = [];
  let offset = 0;
  for (const entry of files) {
    let size: number;
    try {
      size = fs.statSync(entry.file).size;
    } catch {
      continue;
    }
    const name = Buffer.from(entry.name, 'utf8');
    const e: ZipEntry = { name, file: entry.file, size, offset, crc: 0 };
    entries.push(e);
    offset += 30 + name.length + localExtra(e) + size;
  }
  if (entries.length === 0) throw new ApiError('Nothing to download', 404);
  const cdOffset = offset;
  const cdSize = entries.reduce((sum, e) => sum + 46 + e.name.length + centralExtra(e), 0);
  const endSize = endRecords(entries.length, cdOffset, cdSize).reduce((sum, b) => sum + b.length, 0);

  async function* body() {
    for (const e of entries) {
      e.crc = await crcOf(e.file);
      yield localHeader(e, stamp);
      let sent = 0;
      for await (const chunk of fs.createReadStream(e.file)) {
        sent += (chunk as Buffer).length;
        yield chunk as Buffer;
      }
      // Changed while packing: the announced length would be wrong.
      if (sent !== e.size) throw new Error(`${e.file} changed while it was packed`);
    }
    for (const e of entries) yield centralHeader(e, stamp);
    yield* endRecords(entries.length, cdOffset, cdSize);
  }

  return new Response(Readable.toWeb(Readable.from(body())) as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(cdOffset + cdSize + endSize),
      'Content-Disposition': contentDisposition(`${zipName}.zip`),
    },
  });
};

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

export interface MaintenanceReport {
  purged: number;
  missing: string[];
  orphans: string[];
}

// Keeps rows and stored objects in step:
//  - trashed files older than 30 days go for good;
//  - each file row gets its size, and is marked when its object is missing;
//  - stored objects nothing points at any more (failed uploads, deleted
//    pieces) are removed once they are a day old.
// `dryRun` only reports.
export const runPieceFileMaintenance = (options: { dryRun?: boolean } = {}): MaintenanceReport => {
  const report: MaintenanceReport = { purged: 0, missing: [], orphans: [] };
  const cutoff = new Date(Date.now() - TRASH_DAYS * 24 * 3600 * 1000).toISOString();

  if (!options.dryRun) {
    const old = db.prepare('select * from piece_file_trash where deleted_at < ?').all(cutoff) as Row[];
    removeObjects(db.transaction(() => purgeTrashRows(old))());
    report.purged = old.length;
  }

  const rows = db
    .prepare('select id, file_path, size, file_missing from piece_files where file_path is not null')
    .all() as Array<{ id: string; file_path: string; size: number | null; file_missing: number }>;
  const update = db.prepare('update piece_files set size = ?, file_missing = ? where id = ?');
  db.transaction(() => {
    for (const row of rows) {
      let size: number | null = null;
      const file = pieceObjectPath(row.file_path);
      try {
        if (file) size = fs.statSync(file).size;
      } catch {
        size = null;
      }
      if (size == null) report.missing.push(row.file_path);
      const nextSize = size ?? row.size;
      const missing = size == null ? 1 : 0;
      if (!options.dryRun && (nextSize !== row.size || missing !== row.file_missing)) update.run(nextSize, missing, row.id);
    }
  })();

  // Everything still pointed at.
  const referenced = new Set<string>();
  const keys = db
    .prepare(
      `select file_path as key from piece_files where file_path is not null
       union select json_extract(link_preview, '$.image') from piece_files where link_preview is not null
       union select json_extract(row, '$.file_path') from piece_file_trash
       union select json_extract(json_extract(row, '$.link_preview'), '$.image') from piece_file_trash`,
    )
    .all() as { key: string | null }[];
  for (const { key } of keys) if (key) referenced.add(key);
  const fileIds = new Set((db.prepare('select id from piece_files').all() as { id: string }[]).map((r) => r.id));
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  let dirs: fs.Dirent[] = [];
  try {
    dirs = fs.readdirSync(bucketDir(), { withFileTypes: true });
  } catch {
    return report;
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(bucketDir(), dir.name);
    for (const name of fs.readdirSync(dirPath)) {
      if (referenced.has(`${dir.name}/${name}`)) continue;
      // A score's link-preview image belongs to that file.
      const preview = /^preview-(.+)\.jpg$/.exec(name);
      if (preview && fileIds.has(preview[1])) continue;
      const full = path.join(dirPath, name);
      try {
        if (fs.statSync(full).mtimeMs > dayAgo) continue;
        report.orphans.push(`${dir.name}/${name}`);
        if (!options.dryRun) fs.unlinkSync(full);
      } catch {
        /* gone meanwhile */
      }
    }
    if (!options.dryRun) {
      try {
        if (fs.readdirSync(dirPath).length === 0) fs.rmdirSync(dirPath);
      } catch {
        /* not empty or gone */
      }
    }
  }
  return report;
};

export const startPieceFileMaintenance = () => {
  const run = () => {
    try {
      const r = runPieceFileMaintenance();
      if (r.purged || r.orphans.length || r.missing.length) {
        console.log(
          `Piece files: ${r.purged} purged from the trash, ${r.orphans.length} orphaned objects removed, ${r.missing.length} missing on disk`,
        );
      }
    } catch (err) {
      console.error('Piece file maintenance failed', err);
    }
  };
  setTimeout(run, 2 * 60 * 1000).unref();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
};
