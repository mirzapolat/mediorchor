// Generic data API: a small PostgREST-compatible subset on top of SQLite.
//
// The browser sends a JSON description of a query (see src/lib/api.ts); this
// module validates every identifier against the introspected schema, applies
// the access policies from policies.ts and returns rows in the same shape the
// Supabase API did. Supported:
//   select   column lists, `*`, one level of many-to-one embedding
//            (`events(*)`, `events!inner(project_id)`), exact counts, head
//   filters  eq neq gt gte lt lte like ilike in is, each negatable with not.
//            Filters may target embedded columns (`events.project_id`).
//   order    multiple columns, ascending/descending, nullsFirst
//   writes   insert / update / delete / upsert (onConflict), optional returning
import { db, decodeRow, encodeValue, getTableMeta, authUid, ApiError, forbidden, type TableMeta } from './db.ts';
import { policies, isAdmin, type TablePolicy } from './policies.ts';

type Filter = [column: string, operator: string, value: unknown];

export interface DbRequest {
  table: string;
  action: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  // Select list for `select`; returning list for writes (absent = no rows back).
  columns?: string;
  filters?: Filter[];
  order?: { column: string; ascending?: boolean; nullsFirst?: boolean }[];
  limit?: number;
  count?: 'exact';
  head?: boolean;
  values?: Record<string, unknown> | Record<string, unknown>[];
  onConflict?: string;
}

export interface DbResponse {
  data: unknown;
  count: number | null;
}

// ---------------------------------------------------------------------------
// Select parsing
// ---------------------------------------------------------------------------

interface Embed {
  name: string;
  alias: string;
  inner: boolean;
  columns: string[] | '*';
  meta: TableMeta;
  fk: { from: string; to: string };
  policy: TablePolicy;
}

interface Selection {
  columns: string[] | '*';
  embeds: Embed[];
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

const splitTopLevel = (input: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of input) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
};

const checkColumn = (meta: TableMeta, column: string) => {
  if (!IDENT.test(column) || !meta.columns.has(column)) {
    throw new ApiError(`Could not find the '${column}' column of '${meta.name}'`, 400, 'PGRST204');
  }
};

const parseColumnList = (meta: TableMeta, items: string[]): string[] | '*' => {
  if (items.length === 0 || items.includes('*')) return '*';
  for (const item of items) checkColumn(meta, item);
  return items;
};

const parseSelect = (meta: TableMeta, select: string | undefined): Selection => {
  const items = splitTopLevel(select?.trim() || '*');
  const plain: string[] = [];
  const embeds: Embed[] = [];
  for (const item of items) {
    const embed = /^([a-z_][a-z0-9_]*)(!inner)?\((.*)\)$/s.exec(item);
    if (!embed) {
      plain.push(item);
      continue;
    }
    const [, name, inner, inside] = embed;
    const target = getTableMeta(name);
    const fk = meta.foreignKeys.get(name);
    const policy = policies[name];
    if (!target || !fk || !policy?.select) {
      throw new ApiError(
        `Could not find a relationship between '${meta.name}' and '${name}'`,
        400,
        'PGRST200',
      );
    }
    embeds.push({
      name,
      alias: `j${embeds.length}`,
      inner: Boolean(inner),
      columns: parseColumnList(target, splitTopLevel(inside)),
      meta: target,
      fk,
      policy,
    });
  }
  return { columns: parseColumnList(meta, plain), embeds };
};

// ---------------------------------------------------------------------------
// Filters and ordering
// ---------------------------------------------------------------------------

interface Built {
  where: string[];
  // Filters on left-joined embeds restrict the embed, not the parent row.
  joinConditions: Map<string, string[]>;
  params: unknown[];
  joinParams: Map<string, unknown[]>;
}

const resolveColumn = (meta: TableMeta, embeds: Embed[], column: string) => {
  const dot = column.indexOf('.');
  if (dot === -1) {
    checkColumn(meta, column);
    return { ref: `t.${column}`, kind: meta.columns.get(column), embed: undefined };
  }
  const embedName = column.slice(0, dot);
  const embedColumn = column.slice(dot + 1);
  const embed = embeds.find((e) => e.name === embedName);
  if (!embed) throw new ApiError(`'${embedName}' is not embedded in this query`, 400);
  checkColumn(embed.meta, embedColumn);
  return { ref: `${embed.alias}.${embedColumn}`, kind: embed.meta.columns.get(embedColumn), embed };
};

const buildFilters = (meta: TableMeta, embeds: Embed[], filters: Filter[] = []): Built => {
  const built: Built = { where: [], joinConditions: new Map(), params: [], joinParams: new Map() };
  for (const [column, rawOperator, value] of filters) {
    const negate = rawOperator.startsWith('not.');
    const operator = negate ? rawOperator.slice(4) : rawOperator;
    const { ref, kind, embed } = resolveColumn(meta, embeds, column);
    const params: unknown[] = [];
    let sql: string;
    switch (operator) {
      case 'eq':
      case 'neq':
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const op = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[operator];
        sql = `${ref} ${op} ?`;
        params.push(encodeValue(kind, value));
        break;
      }
      case 'like':
        sql = `${ref} like ?`;
        params.push(String(value));
        break;
      case 'ilike':
        sql = `ulower(${ref}) like ulower(?)`;
        params.push(String(value));
        break;
      case 'in':
        if (!Array.isArray(value)) throw new ApiError(`'in' filter on '${column}' needs an array`, 400);
        sql = `${ref} in (select value from json_each(?))`;
        params.push(JSON.stringify(value.map((v) => encodeValue(kind, v))));
        break;
      case 'is':
        if (value === null) sql = `${ref} is null`;
        else if (value === true || value === false) sql = `${ref} is ${value ? 1 : 0}`;
        else throw new ApiError(`'is' filter on '${column}' needs null, true or false`, 400);
        break;
      default:
        throw new ApiError(`Unsupported filter operator '${rawOperator}'`, 400);
    }
    if (negate) sql = `not coalesce(${sql}, 0)`;

    if (embed && !embed.inner) {
      built.joinConditions.set(embed.alias, [...(built.joinConditions.get(embed.alias) ?? []), sql]);
      built.joinParams.set(embed.alias, [...(built.joinParams.get(embed.alias) ?? []), ...params]);
    } else {
      built.where.push(sql);
      built.params.push(...params);
    }
  }
  return built;
};

const buildOrder = (meta: TableMeta, embeds: Embed[], order: DbRequest['order'] = []) =>
  order.map(({ column, ascending = true, nullsFirst }) => {
    const { ref, kind } = resolveColumn(meta, embeds, column);
    // Postgres default: nulls last when ascending, first when descending.
    const nullsAtFront = nullsFirst ?? !ascending;
    const collate = kind === 'text' ? ' collate nocase' : '';
    return `(${ref} is null) ${nullsAtFront ? 'desc' : 'asc'}, ${ref}${collate} ${ascending ? 'asc' : 'desc'}`;
  });

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

const requirePolicy = (table: string, op: keyof TablePolicy) => {
  const policy = policies[table];
  const predicate = policy?.[op];
  if (!predicate || typeof predicate !== 'function') throw forbidden(`permission denied for table ${table}`);
  return predicate as (alias: string) => string;
};

const rlsViolation = (table: string) =>
  new ApiError(`new row violates row-level security policy for table "${table}"`, 403, '42501');

const projection = (selection: Selection) => {
  const parts =
    selection.columns === '*' ? ['t.*'] : selection.columns.map((c) => `t.${c}`);
  for (const embed of selection.embeds) {
    const cols = embed.columns === '*' ? [...embed.meta.columns.keys()] : embed.columns;
    for (const c of cols) parts.push(`${embed.alias}.${c} as "${embed.alias}.${c}"`);
    parts.push(`${embed.alias}.rowid as "${embed.alias}.__rowid"`);
  }
  return parts.join(', ');
};

const joins = (selection: Selection, built: Built) => {
  const sql: string[] = [];
  const params: unknown[] = [];
  for (const embed of selection.embeds) {
    const conditions = [
      `${embed.alias}.${embed.fk.to} = t.${embed.fk.from}`,
      `(${embed.policy.select!(embed.alias)})`,
      ...(built.joinConditions.get(embed.alias) ?? []),
    ];
    sql.push(`${embed.inner ? 'inner' : 'left'} join ${embed.name} ${embed.alias} on ${conditions.join(' and ')}`);
    params.push(...(built.joinParams.get(embed.alias) ?? []));
  }
  return { sql: sql.join(' '), params };
};

const shapeRows = (meta: TableMeta, selection: Selection, rows: Record<string, unknown>[]) =>
  rows.map((row) => {
    const base: Record<string, unknown> = {};
    const embedded: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of Object.entries(row)) {
      const dot = key.indexOf('.');
      if (dot === -1) {
        base[key] = value;
      } else {
        const alias = key.slice(0, dot);
        (embedded[alias] ??= {})[key.slice(dot + 1)] = value;
      }
    }
    const out = decodeRow(meta, base);
    for (const embed of selection.embeds) {
      const raw = embedded[embed.alias] ?? {};
      const found = raw.__rowid !== null && raw.__rowid !== undefined;
      delete raw.__rowid;
      out[embed.name] = found ? decodeRow(embed.meta, raw) : null;
    }
    return out;
  });

const runSelect = (meta: TableMeta, req: DbRequest): DbResponse => {
  const selection = parseSelect(meta, req.columns);
  const built = buildFilters(meta, selection.embeds, req.filters);
  const join = joins(selection, built);
  const where = [`(${requirePolicy(meta.name, 'select')('t')})`, ...built.where].join(' and ');
  const from = `from ${meta.name} t ${join.sql} where ${where}`;
  const params = [...join.params, ...built.params];

  const count =
    req.count === 'exact'
      ? (db.prepare(`select count(*) as n ${from}`).get(...params) as { n: number }).n
      : null;
  if (req.head) return { data: null, count };

  const order = buildOrder(meta, selection.embeds, req.order);
  let sql = `select ${projection(selection)} ${from}`;
  if (order.length) sql += ` order by ${order.join(', ')}`;
  if (req.limit !== undefined) sql += ` limit ${Math.max(0, Math.floor(Number(req.limit)))}`;
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return { data: shapeRows(meta, selection, rows), count };
};

// Rows back from a write, re-read through the select policy.
const returning = (meta: TableMeta, req: DbRequest, rowids: (number | bigint)[]) => {
  if (req.columns === undefined) return null;
  if (rowids.length === 0) return [];
  const selection = parseSelect(meta, req.columns);
  const join = joins(selection, buildFilters(meta, selection.embeds, []));
  const policy = policies[meta.name]?.select;
  const where = policy ? `(${policy('t')})` : 'false';
  const rows = db
    .prepare(
      `select ${projection(selection)} from ${meta.name} t ${join.sql}
       where t.rowid in (select value from json_each(?)) and ${where} order by t.rowid`,
    )
    .all(...join.params, JSON.stringify(rowids.map(Number))) as Record<string, unknown>[];
  return shapeRows(meta, selection, rows);
};

const encodeRow = (meta: TableMeta, row: Record<string, unknown>) => {
  const columns: string[] = [];
  const values: unknown[] = [];
  for (const [column, value] of Object.entries(row)) {
    if (value === undefined) continue;
    checkColumn(meta, column);
    columns.push(column);
    values.push(encodeValue(meta.columns.get(column), value));
  }
  return { columns, values };
};

const asRows = (values: DbRequest['values']) => {
  if (!values) throw new ApiError('Missing values', 400);
  const rows = Array.isArray(values) ? values : [values];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new ApiError('Invalid row', 400);
  }
  return rows;
};

const passes = (meta: TableMeta, predicate: (alias: string) => string, rowids: (number | bigint)[]) => {
  if (rowids.length === 0) return true;
  const { n } = db
    .prepare(
      `select count(*) as n from ${meta.name} t
       where t.rowid in (select value from json_each(?)) and not coalesce((${predicate('t')}), 0)`,
    )
    .get(JSON.stringify(rowids.map(Number))) as { n: number };
  return n === 0;
};

const insertRow = (meta: TableMeta, row: Record<string, unknown>) => {
  policies[meta.name]?.validateInsert?.(row);
  const { columns, values } = encodeRow(meta, row);
  const sql = columns.length
    ? `insert into ${meta.name} (${columns.join(', ')}) values (${columns.map(() => '?').join(', ')})`
    : `insert into ${meta.name} default values`;
  const rowid = db.prepare(sql).run(...values).lastInsertRowid;
  if (!passes(meta, requirePolicy(meta.name, 'insert'), [rowid])) throw rlsViolation(meta.name);
  return rowid;
};

const updateContext = () => ({
  uid: authUid()!,
  isAdmin: Boolean((db.prepare(`select ${isAdmin()} as v`).get() as { v: number }).v),
});

const updateRows = (meta: TableMeta, rowids: (number | bigint)[], patch: Record<string, unknown>) => {
  if (rowids.length === 0) return;
  const policy = policies[meta.name];
  if (policy.validateUpdate) {
    const ctx = updateContext();
    const oldRows = db
      .prepare(`select * from ${meta.name} where rowid in (select value from json_each(?))`)
      .all(JSON.stringify(rowids.map(Number))) as Record<string, unknown>[];
    for (const oldRow of oldRows) policy.validateUpdate(oldRow, patch, ctx);
  }
  const { columns, values } = encodeRow(meta, patch);
  if (columns.length === 0) return;
  db.prepare(
    `update ${meta.name} set ${columns.map((c) => `${c} = ?`).join(', ')}
     where rowid in (select value from json_each(?))`,
  ).run(...values, JSON.stringify(rowids.map(Number)));
  if (!passes(meta, requirePolicy(meta.name, 'check'), rowids)) throw rlsViolation(meta.name);
};

const targetRowids = (meta: TableMeta, op: 'update' | 'delete', filters: Filter[] = []) => {
  if (filters.some(([column]) => column.includes('.'))) {
    throw new ApiError('Filters on embedded resources are not supported for writes', 400);
  }
  const built = buildFilters(meta, [], filters);
  const where = [`(${requirePolicy(meta.name, op)('t')})`, ...built.where].join(' and ');
  return (
    db.prepare(`select t.rowid as r from ${meta.name} t where ${where}`).all(...built.params) as { r: number }[]
  ).map((row) => row.r);
};

const runWrite = (meta: TableMeta, req: DbRequest): DbResponse => {
  switch (req.action) {
    case 'insert': {
      const rowids = asRows(req.values).map((row) => insertRow(meta, row));
      return { data: returning(meta, req, rowids), count: null };
    }
    case 'update': {
      const [patch] = asRows(req.values);
      const rowids = targetRowids(meta, 'update', req.filters);
      updateRows(meta, rowids, patch);
      return { data: returning(meta, req, rowids), count: null };
    }
    case 'delete': {
      const rowids = targetRowids(meta, 'delete', req.filters);
      const data = returning(meta, req, rowids);
      if (rowids.length) {
        db.prepare(`delete from ${meta.name} where rowid in (select value from json_each(?))`).run(
          JSON.stringify(rowids),
        );
      }
      return { data, count: null };
    }
    case 'upsert': {
      const conflict = req.onConflict
        ? req.onConflict.split(',').map((c) => c.trim())
        : (db.pragma(`table_info("${meta.name}")`) as { name: string; pk: number }[])
            .filter((c) => c.pk > 0)
            .map((c) => c.name);
      for (const column of conflict) checkColumn(meta, column);
      const find = db.prepare(
        `select rowid as r from ${meta.name} where ${conflict.map((c) => `${c} = ?`).join(' and ')}`,
      );
      const rowids = asRows(req.values).map((row) => {
        const key = conflict.map((c) => encodeValue(meta.columns.get(c), row[c]));
        const existing = find.get(...key) as { r: number } | undefined;
        if (!existing) return insertRow(meta, row);
        if (!passes(meta, requirePolicy(meta.name, 'update'), [existing.r])) throw rlsViolation(meta.name);
        const patch = Object.fromEntries(Object.entries(row).filter(([c]) => !conflict.includes(c)));
        updateRows(meta, [existing.r], patch);
        return existing.r;
      });
      return { data: returning(meta, req, rowids), count: null };
    }
    default:
      throw new ApiError(`Unsupported action '${String(req.action)}'`, 400);
  }
};

// Entry point. Must run inside asUser(); every write is one transaction.
export const executeDbRequest = (req: DbRequest): DbResponse => {
  if (!req || typeof req.table !== 'string' || !IDENT.test(req.table)) {
    throw new ApiError('Invalid request', 400);
  }
  const meta = getTableMeta(req.table);
  if (!meta || !policies[req.table]) {
    throw new ApiError(`Could not find the table '${req.table}'`, 404, 'PGRST205');
  }
  if (req.action === 'select') return runSelect(meta, req);
  return db.transaction(() => runWrite(meta, req))();
};
