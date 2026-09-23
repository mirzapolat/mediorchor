// Incoming webhooks for registration pages with source = 'webhook'. External
// form tools (Google Forms via Apps Script, Microsoft Forms via Power Automate,
// Zapier, IFTTT, Make, curl, …) POST one entry per request. The unguessable
// page token in the URL is the credential; rotating it revokes the old URL.
//
// Accepted bodies: JSON (flat or nested objects, arrays of {label, value}
// pairs), application/x-www-form-urlencoded and multipart/form-data. Query
// parameters are merged in as well.
import { Hono, type Context } from 'hono';
import { db, nowIso, ApiError } from './db.ts';
import { rateLimit } from './ratelimit.ts';
import { projectGroupNames, registrationToMember } from './rpc.ts';
import { extractRegistration, matchFields, parseMapping, type Fields } from './fieldMatching.ts';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_STORED_FIELDS = 50;
const MAX_STORED_VALUE = 300;

const isScalar = (v: unknown): v is string | number | boolean =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

// Arrays like [{ title: "Vorname", answer: "Anna" }] become { Vorname: "Anna" }.
const LABEL_KEYS = ['title', 'label', 'question', 'name', 'key', 'field'];
const VALUE_KEYS = ['answer', 'value', 'response', 'text'];

const flatten = (value: unknown, prefix: string, out: Fields) => {
  if (value == null) return;
  if (isScalar(value)) {
    if (prefix) out[prefix] = String(value).trim();
    return;
  }
  if (typeof File !== 'undefined' && value instanceof File) return;
  if (Array.isArray(value)) {
    if (value.every(isScalar)) {
      if (prefix) out[prefix] = value.map((v) => String(v).trim()).filter(Boolean).join(', ');
      return;
    }
    value.forEach((item, index) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const obj = item as Record<string, unknown>;
        const labelKey = LABEL_KEYS.find((k) => typeof obj[k] === 'string');
        const valueKey = VALUE_KEYS.find((k) => k in obj);
        if (labelKey && valueKey) {
          flatten(obj[valueKey], String(obj[labelKey]), out);
          return;
        }
      }
      flatten(item, prefix ? `${prefix}.${index}` : String(index), out);
    });
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
  }
};

const readFields = async (c: Context): Promise<Fields> => {
  if (Number(c.req.header('content-length') ?? 0) > MAX_BODY_BYTES) {
    throw new ApiError('Payload too large', 413);
  }
  const type = (c.req.header('content-type') ?? '').toLowerCase();
  let body: unknown = {};
  if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
    body = await c.req.parseBody({ all: true });
  } else {
    const raw = await c.req.text();
    if (raw.length > MAX_BODY_BYTES) throw new ApiError('Payload too large', 413);
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = Object.fromEntries(new URLSearchParams(raw));
      }
    }
  }
  if (Array.isArray(body) && body.length > 0 && !body.every(isScalar)) body = body[0];

  const fields: Fields = {};
  flatten(c.req.queries(), '', fields);
  flatten(body, '', fields);
  return fields;
};

const storedFields = (fields: Fields): Fields =>
  Object.fromEntries(
    Object.entries(fields)
      .slice(0, MAX_STORED_FIELDS)
      .map(([k, v]) => [k.slice(0, 120), v.slice(0, MAX_STORED_VALUE)]),
  );

interface WebhookPage {
  id: string;
  project_id: string;
  is_active: number;
  auto_transfer: number;
  webhook_mapping: string;
}

const findPage = (token: string) =>
  db
    .prepare(
      `select rp.id, rp.project_id, rp.is_active, rp.auto_transfer, rp.webhook_mapping
       from registration_pages rp
       where rp.token = ? and rp.source = 'webhook'`,
    )
    .get(token) as WebhookPage | undefined;

export const webhookRoutes = new Hono();

// A GET lets people check the URL in a browser without creating anything.
webhookRoutes.get('/registrations/:token', (c) => {
  if (!findPage(c.req.param('token'))) return c.json({ ok: false, error: 'not_found' }, 404);
  return c.json({ ok: true, message: 'Webhook is reachable. Send registrations with POST.' });
});

webhookRoutes.post('/registrations/:token', async (c) => {
  const token = c.req.param('token');
  rateLimit(c, `webhook:${token}`, 120, 60 * 1000);
  const page = findPage(token);
  if (!page) return c.json({ ok: false, error: 'not_found' }, 404);

  const fields = await readFields(c);
  const matched = matchFields(fields, parseMapping(page.webhook_mapping));
  const record = (status: string) =>
    db
      .prepare(
        `update registration_pages
         set webhook_last_payload = ?, webhook_last_received_at = ?, webhook_last_status = ?
         where id = ?`,
      )
      .run(JSON.stringify({ fields: storedFields(fields), matched }), nowIso(), status, page.id);

  if (!page.is_active) {
    record('inactive');
    return c.json({ ok: false, error: 'inactive' }, 409);
  }

  const result = extractRegistration(fields, matched, projectGroupNames(page.project_id));
  if (!result.ok) {
    record(result.error);
    return c.json({ ok: false, error: result.error }, 422);
  }
  const { firstName, lastName, email, groupName, knownGroup } = result;
  // Registrations with a group the project doesn't have are never auto-transferred.
  const canTransfer = Boolean(page.auto_transfer) && knownGroup;

  const memberId = db.transaction(() => {
    const id = canTransfer
      ? registrationToMember(page.project_id, firstName, lastName, groupName, email, null)
      : null;
    db.prepare(
      `insert into registrations
         (registration_page_id, first_name, last_name, email, group_name, member_id, transferred, raw_payload)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(page.id, firstName, lastName, email, groupName, id, id ? 1 : 0, JSON.stringify(storedFields(fields)));
    record('ok');
    return id;
  })();

  return c.json({ ok: true, transferred: Boolean(memberId) });
});
