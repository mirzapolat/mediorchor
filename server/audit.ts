// Audit log: who did what and when — every action of every person, shown in
// Admin Config → Audit-Log.
//
// Two layers work together:
//  - A context per unit of work (an API request, a background job, a CLI
//    command), carried through async code by AsyncLocalStorage: who (account,
//    IP, device), what (action key), and how it ended. It is written to
//    audit_log when the work is done.
//  - Temporary triggers on every table (installAuditTriggers) that record
//    each inserted, updated and deleted row into audit_changes under the
//    current context. They sit below every write path — the generic table
//    API, server functions, sign-in, webhooks, background jobs — so nothing
//    that changes data goes unrecorded, and a rolled-back transaction takes
//    its change rows with it. TEMP triggers live only in this connection:
//    other tools opening the database never see them (or need our functions).
//
// Pure reads (opening a page, loading a list) are not actions and are not
// logged; a failed attempt to change something is.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Context, Next } from 'hono';
import { db, uuid, nowIso, getTableMeta, type ColumnKind } from './db.ts';
import { clientIp } from './ratelimit.ts';

type Row = Record<string, unknown>;

export type ActorKind = 'user' | 'anonymous' | 'system' | 'webhook';

interface AuditContext {
  id: string;
  at: string;
  kind: ActorKind;
  actorId: string | null;
  // Name for actors without an account (the CLI, background jobs).
  actorName: string | null;
  action: string;
  target: string | null;
  method: string | null;
  path: string | null;
  ip: string | null;
  userAgent: string | null;
  details: Row;
  // Logged even when no row changed (sign-ins, uploads, …).
  force: boolean;
  // Failures are logged only for work meant to change something.
  writeIntent: boolean;
  failure: { status: number; message: string } | null;
  changes: number;
  flushed: boolean;
  // Set for anonymous survey responses: nothing about the sender is kept.
  anonymized: boolean;
}

const storage = new AsyncLocalStorage<AuditContext>();

const newContext = (init: Partial<AuditContext> & Pick<AuditContext, 'kind' | 'action'>): AuditContext => ({
  id: uuid(),
  at: nowIso(),
  actorId: null,
  actorName: null,
  target: null,
  method: null,
  path: null,
  ip: null,
  userAgent: null,
  details: {},
  force: false,
  writeIntent: false,
  failure: null,
  changes: 0,
  flushed: false,
  anonymized: false,
  ...init,
});

// Changes outside any request or job (start-up, timers) are grouped per tick
// into one "system" entry, so not a single one is lost.
let ambient: AuditContext | null = null;
const ambientContext = () => {
  if (!ambient) {
    const ctx = newContext({ kind: 'system', action: 'system.task', actorName: 'System' });
    ambient = ctx;
    setImmediate(() => {
      if (ambient === ctx) ambient = null;
      flush(ctx);
    });
  }
  return ambient;
};

const current = () => storage.getStore() ?? ambientContext();

// ---------------------------------------------------------------------------
// What the triggers record
// ---------------------------------------------------------------------------

// Bookkeeping, not actions: sessions and one-time challenges/tokens (sign-ins
// and sign-outs are logged as actions instead), mail and notification queues,
// and the log itself.
const SKIP_TABLES = new Set([
  '_migrations',
  'audit_log',
  'audit_changes',
  'auth_sessions',
  'auth_challenges',
  'auth_tokens',
  'auth_password_resets',
  'mail_log',
  'confirmation_log',
  'notification_log',
  'notification_outbox',
  // Survey answers never reach the log: what people answered, when they
  // drafted, what they uploaded and that they took part (server/forms.ts
  // records only that a response came in).
  'form_responses',
  'form_receipts',
  'form_drafts',
  'form_files',
]);

// Columns that change by themselves (timestamps, counters, heartbeats) or
// repeat what the entry already says. A change to only these is no action.
const IGNORED: Record<string, string[]> = {
  '*': ['created_at', 'updated_at', 'sequence'],
  auth_users: ['last_seen_at'],
  auth_factors: ['last_step'],
  auth_passkeys: ['counter', 'last_used_at'],
  calendar_links: ['last_fetched_at'],
  pieces: ['markers_locked_at'],
  registration_pages: ['webhook_last_payload', 'webhook_last_received_at', 'webhook_last_status'],
  // The builder saves the draft while typing; publishing is the action.
  forms: ['draft', 'draft_saved_at', 'notify_sent_at', 'notify_sent_count'],
  // Saved while typing; creating the project is the action.
  onboarding_drafts: ['data'],
};

// Secrets and credentials: recorded as changed, never with their value.
const SECRET: Record<string, string[]> = {
  auth_users: ['password_hash'],
  auth_factors: ['secret'],
  auth_passkeys: ['public_key'],
  smtp_settings: ['password_enc'],
  registration_pages: ['token'],
  event_checkins: ['token'],
  calendars: ['feed_token'],
  calendar_links: ['token'],
  forms: ['token'],
  form_invites: ['token'],
};

const SECRET_VALUE = { $secret: true };
// Longer values (score timelines, bar maps, …) are kept as their size only.
const MAX_VALUE = 2000;

const personName = (row: Row) => [row.first_name, row.last_name].filter(Boolean).join(' ');
const withDate = (row: Row, date: unknown) => [row.name, date].filter(Boolean).join(' · ');

// The display name of a row: what a person would call it.
const LABELS: Record<string, (row: Row) => unknown> = {
  app_users: (r) => r.name || personName(r) || r.email,
  auth_users: (r) => r.email,
  members: personName,
  registrations: personName,
  checkin_submissions: personName,
  events: (r) => withDate(r, r.date),
  calendar_events: (r) => withDate(r, r.date),
  calendar_event_exceptions: (r) => withDate(r, r.occurrence_date),
  registration_pages: (r) => r.title,
  piece_files: (r) => r.title || r.file_name,
  piece_tracks: (r) => r.title,
  smtp_settings: (r) => r.host,
  pieces: (r) => [r.name, r.composer].filter(Boolean).join(' – '),
};

const labelOf = (table: string, row: Row) => {
  const value = LABELS[table] ? LABELS[table](row) : (row.name ?? row.title);
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
};

interface TableRules {
  columns: Map<string, ColumnKind>;
  key: string[];
  ignored: Set<string>;
  secret: Set<string>;
  // Foreign key column → referenced table and column.
  refs: Map<string, { table: string; to: string }>;
}

const rules = new Map<string, TableRules>();

const decodeValue = (kind: ColumnKind | undefined, value: unknown) => {
  if (value === null || value === undefined) return null;
  if (kind === 'boolean') return Boolean(value);
  if (kind === 'json' && typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
};

const loggable = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const size = typeof value === 'string' ? value.length : JSON.stringify(value).length;
  return size > MAX_VALUE ? { $size: size } : value;
};

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

const decodeRow = (r: TableRules, json: unknown): Row | null => {
  if (typeof json !== 'string') return null;
  const raw = JSON.parse(json) as Row;
  const row: Row = {};
  for (const [column, value] of Object.entries(raw)) row[column] = decodeValue(r.columns.get(column), value);
  return row;
};

// Called by the triggers for every row change. Returns what to store, or null
// when nothing worth recording changed. Never throws: an audit problem must
// not break the write itself.
const capture = (table: unknown, _op: unknown, oldJson: unknown, newJson: unknown): string | null => {
  try {
    const r = rules.get(String(table));
    if (!r) return null;
    const before = decodeRow(r, oldJson);
    const after = decodeRow(r, newJson);
    const row = (after ?? before)!;
    const data: Row = {};

    if (before && after) {
      for (const [column, value] of Object.entries(after)) {
        if (r.ignored.has(column) || same(before[column], value)) continue;
        data[column] = r.secret.has(column) ? [SECRET_VALUE, SECRET_VALUE] : [loggable(before[column]), loggable(value)];
      }
      if (Object.keys(data).length === 0) return null;
    } else {
      for (const [column, value] of Object.entries(row)) {
        if (r.ignored.has(column) || r.key.includes(column) || value === null || value === '') continue;
        data[column] = r.secret.has(column) ? SECRET_VALUE : loggable(value);
      }
    }

    const refs: Row = {};
    for (const [column, ref] of r.refs) {
      if (row[column] != null) refs[column] = { table: ref.table, id: row[column] };
    }

    const ctx = current();
    ctx.changes++;
    // Changes after the entry was written (work that outlives its request)
    // update it.
    if (ctx.flushed) {
      ctx.flushed = false;
      setImmediate(() => flush(ctx));
    }
    return JSON.stringify({
      log: ctx.id,
      key: r.key.map((k) => row[k]).join('/'),
      label: labelOf(String(table), row),
      data,
      refs: Object.keys(refs).length ? refs : null,
    });
  } catch (err) {
    console.error('Audit capture failed:', err);
    return null;
  }
};

db.function('audit_capture', { deterministic: false }, capture);

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

// Installs the change triggers on every table. Call after migrate() and
// loadTableMeta(); TEMP triggers last as long as the connection.
export const installAuditTriggers = () => {
  rules.clear();
  const tables = db
    .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
    .all() as { name: string }[];
  for (const { name } of tables) {
    if (SKIP_TABLES.has(name)) continue;
    const meta = getTableMeta(name);
    if (!meta) continue;
    const columns = [...meta.columns.keys()].filter((c) => !meta.generated.has(c));
    const info = db.pragma(`table_info(${quote(name)})`) as { name: string; pk: number }[];
    const key = info.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    const refs = new Map(
      (db.pragma(`foreign_key_list(${quote(name)})`) as { table: string; from: string; to: string | null }[]).map(
        (fk) => [fk.from, { table: fk.table, to: fk.to ?? 'id' }],
      ),
    );
    rules.set(name, {
      columns: meta.columns,
      key: key.length ? key : ['rowid'],
      ignored: new Set([...IGNORED['*'], ...(IGNORED[name] ?? [])]),
      secret: new Set(SECRET[name] ?? []),
      refs,
    });

    const row = (alias: 'old' | 'new') =>
      `json_object(${columns.map((c) => `'${c}', ${alias}.${quote(c)}`).join(', ')})`;
    for (const [op, oldRow, newRow] of [
      ['insert', 'null', row('new')],
      ['update', row('old'), row('new')],
      ['delete', row('old'), 'null'],
    ] as const) {
      const trigger = quote(`audit_${name}_${op}`);
      db.exec(`drop trigger if exists temp.${trigger}`);
      db.exec(
        `create temp trigger ${trigger} after ${op} on main.${quote(name)} begin
           insert into audit_changes (log_id, table_name, op, row_key, label, data, refs)
           select json_extract(r, '$.log'), '${name}', '${op}', json_extract(r, '$.key'),
                  json_extract(r, '$.label'), json_extract(r, '$.data'), json_extract(r, '$.refs')
           from (select audit_capture('${name}', '${op}', ${oldRow}, ${newRow}) as r) where r is not null;
         end`,
      );
    }
  }
};

// ---------------------------------------------------------------------------
// Writing an entry
// ---------------------------------------------------------------------------

const categoryOf = (ctx: AuditContext) => {
  const { action } = ctx;
  if (action.startsWith('auth.')) return 'auth';
  if (action.startsWith('admin.') || ctx.target === 'app_settings') return 'admin';
  if (action.startsWith('storage.')) return 'files';
  if (action.startsWith('webhook.')) return 'webhook';
  if (action === 'rpc.submit_public_checkin' || action === 'rpc.submit_public_registration') return 'public';
  if (ctx.kind === 'system') return 'system';
  return 'data';
};

const actorSnapshot = (ctx: AuditContext) => {
  if (!ctx.actorId) return { name: ctx.actorName, email: null };
  const row = db.prepare('select name, email from app_users where id = ?').get(ctx.actorId) as
    | { name: string; email: string }
    | undefined;
  if (row) return { name: row.name || row.email, email: row.email };
  // Gone with this very action (an account deleting itself): the change row
  // still has the profile.
  const gone = db
    .prepare(
      `select data from audit_changes
       where log_id = ? and table_name = 'app_users' and op = 'delete' and row_key = ?`,
    )
    .get(ctx.id, ctx.actorId) as { data: string } | undefined;
  const data = gone ? (JSON.parse(gone.data) as Row) : {};
  const email = typeof data.email === 'string' ? data.email : null;
  return { name: labelOf('app_users', data) ?? email, email };
};

const lookupLabel = (table: string, to: string, id: unknown) => {
  const meta = getTableMeta(table);
  if (!meta) return null;
  const row = db.prepare(`select * from ${quote(table)} where ${quote(to)} = ?`).get(id) as Row | undefined;
  if (!row) return null;
  const decoded: Row = {};
  for (const [column, value] of Object.entries(row)) decoded[column] = decodeValue(meta.columns.get(column), value);
  return labelOf(table, decoded);
};

// Names the rows each change points to (the member and Probe of an
// attendance, …) as they were at the time. Rows deleted by the same action
// are named from their own change rows.
const resolveRefs = (logId: string) => {
  const changes = db
    .prepare('select id, table_name, refs from audit_changes where log_id = ? and refs is not null')
    .all(logId) as { id: number; table_name: string; refs: string }[];
  if (changes.length === 0) return;
  const deleted = new Map(
    (
      db
        .prepare(`select table_name, row_key, label from audit_changes where log_id = ? and op = 'delete'`)
        .all(logId) as { table_name: string; row_key: string; label: string | null }[]
    ).map((d) => [`${d.table_name}:${d.row_key}`, d.label]),
  );
  const cache = new Map<string, string | null>();
  const update = db.prepare('update audit_changes set refs = ? where id = ?');
  for (const change of changes) {
    const refs = JSON.parse(change.refs) as Record<string, { table: string; id: unknown; label?: string | null }>;
    let touched = false;
    for (const [column, ref] of Object.entries(refs)) {
      if ('label' in ref) continue;
      const to = rules.get(change.table_name)?.refs.get(column)?.to ?? 'id';
      const cacheKey = `${ref.table}:${to}:${String(ref.id)}`;
      if (!cache.has(cacheKey)) {
        cache.set(cacheKey, lookupLabel(ref.table, to, ref.id) ?? deleted.get(`${ref.table}:${String(ref.id)}`) ?? null);
      }
      ref.label = cache.get(cacheKey)!;
      touched = true;
    }
    if (touched) update.run(JSON.stringify(refs), change.id);
  }
};

const flush = (ctx: AuditContext) => {
  ctx.flushed = true;
  const failedAttempt = Boolean(ctx.failure && ctx.writeIntent);
  if (!ctx.changes && !ctx.force && !failedAttempt) return;
  try {
    db.transaction(() => {
      const { n } = db.prepare('select count(*) as n from audit_changes where log_id = ?').get(ctx.id) as { n: number };
      // Everything rolled back and nothing else to say.
      if (!n && !ctx.force && !failedAttempt) return;
      const actor = actorSnapshot(ctx);
      db.prepare(
        `insert into audit_log
           (id, at, actor_kind, actor_id, actor_name, actor_email, category, action, target,
            method, path, ip, user_agent, status, error, details, change_count)
         values
           (@id, @at, @kind, @actor_id, @actor_name, @actor_email, @category, @action, @target,
            @method, @path, @ip, @user_agent, @status, @error, @details, @change_count)
         on conflict (id) do update set
           change_count = excluded.change_count,
           actor_name = coalesce(audit_log.actor_name, excluded.actor_name),
           actor_email = coalesce(audit_log.actor_email, excluded.actor_email)`,
      ).run({
        id: ctx.id,
        at: ctx.at,
        kind: ctx.kind,
        actor_id: ctx.actorId,
        actor_name: actor.name,
        actor_email: actor.email,
        category: categoryOf(ctx),
        action: ctx.action,
        target: ctx.target,
        method: ctx.method,
        path: ctx.path,
        ip: ctx.ip,
        user_agent: ctx.userAgent,
        status: ctx.failure ? 'failed' : 'ok',
        error: ctx.failure?.message.slice(0, 500) ?? null,
        details: Object.keys(ctx.details).length ? JSON.stringify(ctx.details) : null,
        change_count: n,
      });
      resolveRefs(ctx.id);
    })();
  } catch (err) {
    console.error('Writing the audit log failed:', err);
  }
};

// ---------------------------------------------------------------------------
// Context API for request handlers
// ---------------------------------------------------------------------------

// The account the current work runs as (set when a session resolves or a
// sign-in starts one).
export const auditActor = (userId: string | null | undefined) => {
  const ctx = storage.getStore();
  if (!ctx || !userId || ctx.actorId === userId || ctx.anonymized) return;
  ctx.actorId = userId;
  if (ctx.kind === 'anonymous') ctx.kind = 'user';
};

// Describes the current action more precisely than its URL does.
export const auditNote = (note: {
  action?: string;
  target?: string | null;
  details?: Row;
  // Log it even if no row changes.
  force?: boolean;
  // Whether it is meant to change something (failures are logged then).
  write?: boolean;
  // Rows it was not allowed to touch: a failed attempt, though the request succeeds.
  denied?: number;
}) => {
  const ctx = storage.getStore();
  if (!ctx || ctx.anonymized) return;
  if (note.action) ctx.action = note.action;
  if (note.target !== undefined) ctx.target = note.target;
  if (note.details) Object.assign(ctx.details, note.details);
  if (note.force) ctx.force = true;
  if (note.write !== undefined) ctx.writeIntent = note.write;
  if (note.denied) {
    ctx.details.denied_rows = note.denied;
    ctx.failure = { status: 403, message: 'Permission denied' };
  }
};

// An anonymous survey response (or its upload): the entry may only say that
// one came in — not who sent it, from where, with which device or link. Holds
// for the rest of the request (later notes can't add anything back).
export const auditAnonymous = (action: string) => {
  const ctx = storage.getStore();
  if (!ctx) return;
  Object.assign(ctx, {
    kind: 'anonymous',
    actorId: null,
    actorName: null,
    action,
    target: null,
    method: null,
    path: null,
    ip: null,
    userAgent: null,
    details: {},
    force: true,
    anonymized: true,
  });
};

// Requests that change nothing although they are POSTs: steps of a sign-in
// or confirmation, and the admin pages' reads.
const READ_PATHS = new Set([
  '/api/auth/passkey/options',
  '/api/auth/mfa/challenge/passkey',
  '/api/auth/reauth/start',
  '/api/auth/mfa/passkeys/options',
  '/api/auth/password-reset/check',
  '/api/functions/admin-server-info',
  '/api/functions/admin-smtp-get',
  '/api/functions/admin-mail-stats',
  '/api/functions/admin-audit-log',
  '/api/functions/admin-audit-entry',
]);

// Flow signals, not failures: the client asks for a confirmation and retries.
const EXPECTED_ERRORS = new Set(['reauth_required', 'mfa_setup_required']);

const defaultAction = (method: string, path: string) => {
  if (path.startsWith('/api/auth/')) {
    const rest = path.slice('/api/auth/'.length).replace(/\//g, '.');
    return method === 'PATCH' || method === 'DELETE' ? `auth.${rest}.${method.toLowerCase()}` : `auth.${rest}`;
  }
  if (path.startsWith('/api/functions/')) return `admin.${path.slice('/api/functions/'.length).replace(/^admin-/, '')}`;
  if (path.startsWith('/api/storage/')) return method === 'DELETE' ? 'storage.delete' : 'storage.upload';
  if (path.startsWith('/api/webhooks/')) return 'webhook.registration';
  // Refined by the handler; these stay when a guard rejects the request first.
  if (path.startsWith('/api/rpc/')) return `rpc.${path.slice('/api/rpc/'.length).slice(0, 64)}`;
  if (path === '/api/db') return 'db.request';
  return `request.${method.toLowerCase()}`;
};

// Paths that carry a credential (webhook and calendar feed tokens) are
// logged without it.
const safePath = (path: string) =>
  path.replace(/^(\/api\/(?:webhooks\/registrations|calendar-feed))\/.+$/, '$1/…').slice(0, 300);

// Middleware for /api/*: one context per request, written when it ends.
export const auditRequests = async (c: Context, next: Next) => {
  const { method } = c.req;
  const path = c.req.path;
  const ctx = newContext({
    kind: path.startsWith('/api/webhooks/') ? 'webhook' : 'anonymous',
    action: defaultAction(method, path),
    method,
    path: safePath(path),
    ip: clientIp(c),
    userAgent: (c.req.header('user-agent') ?? '').slice(0, 300) || null,
    writeIntent: method !== 'GET' && method !== 'HEAD' && !READ_PATHS.has(path),
  });
  await storage.run(ctx, next);
  const status = c.res.status;
  const error = c.error as (Error & { code?: string }) | undefined;
  if (!ctx.failure && status >= 400 && status !== 401 && !EXPECTED_ERRORS.has(error?.code ?? '')) {
    ctx.failure = { status, message: error?.message || `HTTP ${status}` };
  }
  flush(ctx);
};

// Runs non-request work (CLI commands, jobs) as one logged action.
export const runAudited = async <T>(
  init: { action: string; actorName: string; details?: Row },
  fn: () => Promise<T> | T,
): Promise<T> => {
  const ctx = newContext({ kind: 'system', ...init, details: init.details ?? {}, force: true, writeIntent: true });
  try {
    return await storage.run(ctx, fn);
  } catch (err) {
    ctx.failure = { status: 500, message: err instanceof Error ? err.message : String(err) };
    throw err;
  } finally {
    flush(ctx);
  }
};

// ---------------------------------------------------------------------------
// Reading (Admin Config → Audit-Log)
// ---------------------------------------------------------------------------

const PAGE = 50;
// Changes sent along per entry in the list; the rest on demand.
const CHANGES_PER_ENTRY = 25;
const CATEGORIES = new Set(['auth', 'data', 'public', 'files', 'admin', 'webhook', 'system']);
const RANGES: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };

const parseJson = (value: unknown) => (typeof value === 'string' ? (JSON.parse(value) as unknown) : null);

const shapeChange = (c: Row) => ({
  id: c.id,
  table: c.table_name,
  op: c.op,
  key: c.row_key,
  label: c.label,
  data: parseJson(c.data),
  refs: parseJson(c.refs),
});

export const listAuditLog = (input: Row) => {
  const where: string[] = [];
  const params: Row = {};
  const before = Number(input.before);
  if (Number.isInteger(before) && before > 0) {
    where.push('l.rowid < @before');
    params.before = before;
  }
  const actor = typeof input.actor === 'string' ? input.actor : '';
  if (actor === '@anonymous' || actor === '@system' || actor === '@webhook') {
    where.push('l.actor_kind = @kind');
    params.kind = actor.slice(1);
  } else if (actor) {
    where.push('l.actor_id = @actor');
    params.actor = actor;
  }
  if (typeof input.category === 'string' && CATEGORIES.has(input.category)) {
    where.push('l.category = @category');
    params.category = input.category;
  }
  if (input.status === 'failed') where.push(`l.status = 'failed'`);
  if (typeof input.range === 'string' && Object.hasOwn(RANGES, input.range)) {
    where.push('l.at >= @since');
    params.since = new Date(Date.now() - RANGES[input.range] * 86_400_000).toISOString();
  }
  const q = typeof input.q === 'string' ? input.q.trim().slice(0, 200) : '';
  if (q) {
    params.q = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const like = (column: string) => `${column} like @q escape '\\'`;
    where.push(
      `(${['l.actor_name', 'l.actor_email', 'l.action', 'l.target', 'l.ip', 'l.error', 'l.details'].map(like).join(' or ')}
        or exists (select 1 from audit_changes c where c.log_id = l.id
                   and (${['c.label', 'c.refs', 'c.data'].map(like).join(' or ')})))`,
    );
  }

  const rows = db
    .prepare(
      `select l.rowid as seq, l.* from audit_log l
       ${where.length ? `where ${where.join(' and ')}` : ''}
       order by l.rowid desc limit ${PAGE + 1}`,
    )
    .all(params) as Row[];
  const more = rows.length > PAGE;
  const page = rows.slice(0, PAGE);
  const ids = JSON.stringify(page.map((r) => r.id));

  const changes = new Map<unknown, Row[]>();
  for (const c of db
    .prepare(
      `select * from (
         select c.*, row_number() over (partition by c.log_id order by c.id) as n
         from audit_changes c where c.log_id in (select value from json_each(?))
       ) where n <= ${CHANGES_PER_ENTRY} order by id`,
    )
    .all(ids) as Row[]) {
    changes.set(c.log_id, [...(changes.get(c.log_id) ?? []), shapeChange(c)]);
  }
  // How many rows of which table each entry changed, for the summary line.
  const counts = new Map<unknown, Row[]>();
  for (const c of db
    .prepare(
      `select log_id, table_name, op, count(*) as count from audit_changes
       where log_id in (select value from json_each(?)) group by log_id, table_name, op order by min(id)`,
    )
    .all(ids) as Row[]) {
    counts.set(c.log_id, [...(counts.get(c.log_id) ?? []), { table: c.table_name, op: c.op, count: c.count }]);
  }

  return {
    entries: page.map((r) => ({
      seq: r.seq,
      id: r.id,
      at: r.at,
      actor: { kind: r.actor_kind, id: r.actor_id, name: r.actor_name, email: r.actor_email },
      category: r.category,
      action: r.action,
      target: r.target,
      method: r.method,
      path: r.path,
      ip: r.ip,
      user_agent: r.user_agent,
      status: r.status,
      error: r.error,
      details: parseJson(r.details),
      change_count: r.change_count,
      changes: changes.get(r.id) ?? [],
      change_summary: counts.get(r.id) ?? [],
    })),
    next: more ? page[page.length - 1].seq : null,
    // Everyone in the log, for the person filter (first page only).
    actors: params.before
      ? undefined
      : db
          .prepare(
            `select actor_id as id, actor_name as name, actor_email as email, max(rowid) as latest
             from audit_log where actor_id is not null group by actor_id order by name collate nocase`,
          )
          .all(),
  };
};

// All changes of one entry (the list sends only the first few).
export const auditEntryChanges = (id: unknown) =>
  (
    db.prepare('select * from audit_changes where log_id = ? order by id limit 5000').all(String(id ?? '')) as Row[]
  ).map(shapeChange);
