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

const MAX_BODY_BYTES = 64 * 1024;
const MAX_STORED_FIELDS = 50;
const MAX_STORED_VALUE = 300;

type Fields = Record<string, string>;
type Target = 'first_name' | 'last_name' | 'full_name' | 'email' | 'group_name';
const TARGETS: Target[] = ['first_name', 'last_name', 'full_name', 'email', 'group_name'];

// Lower-case, keep letters/digits only ("E-Mail-Adresse" → "emailadresse").
const norm = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');

// Synonyms per target (normalized). Exact matches win over "contains" matches.
const SYNONYMS: Record<Target, string[]> = {
  first_name: ['firstname', 'first', 'vorname', 'givenname', 'forename', 'prenom'],
  last_name: ['lastname', 'last', 'nachname', 'surname', 'familyname', 'familienname', 'nom'],
  full_name: ['name', 'fullname', 'vollername', 'vollstaendigername', 'deinname', 'ihrname', 'yourname'],
  email: ['email', 'emailaddress', 'emailadresse', 'mail', 'mailadresse', 'respondentemail'],
  group_name: ['group', 'gruppe', 'stimme', 'stimmgruppe', 'stimmlage', 'voice', 'instrument', 'register', 'section'],
};

// A "name" field only counts as the full name when it isn't qualified.
const NAME_QUALIFIERS = ['vor', 'nach', 'first', 'last', 'sur', 'given', 'famil', 'user', 'nick'];

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

// Field whose full key or last path segment matches `wanted`.
const findKey = (fields: Fields, wanted: string): string | null => {
  const target = norm(wanted);
  if (!target) return null;
  return (
    Object.keys(fields).find((k) => norm(k) === target) ??
    Object.keys(fields).find((k) => norm(k.split('.').pop() ?? '') === target) ??
    null
  );
};

const guessKey = (fields: Fields, target: Target, taken: Set<string>): string | null => {
  const keys = Object.keys(fields).filter((k) => !taken.has(k) && fields[k] !== '');
  const leaf = (k: string) => norm(k.split('.').pop() ?? k);
  const exact = keys.find((k) => SYNONYMS[target].includes(leaf(k)));
  if (exact) return exact;
  return (
    keys.find((k) => {
      const n = leaf(k);
      if (target === 'full_name') {
        return n.includes('name') && !NAME_QUALIFIERS.some((q) => n.includes(q));
      }
      // Short synonyms ("last", "mail", "nom") only match exactly.
      return SYNONYMS[target].some((s) => s.length >= 5 && n.includes(s));
    }) ?? null
  );
};

// Which incoming field feeds which target: explicit mapping first, then guesses.
const matchFields = (fields: Fields, mapping: Partial<Record<Target, string>>) => {
  const matched = {} as Record<Target, string | null>;
  const taken = new Set<string>();
  for (const target of TARGETS) {
    const explicit = mapping[target]?.trim();
    matched[target] = explicit ? findKey(fields, explicit) : null;
    if (matched[target]) taken.add(matched[target]!);
  }
  for (const target of TARGETS) {
    if (mapping[target]?.trim() || matched[target]) continue;
    // A full name is only needed when first/last aren't both there.
    if (target === 'full_name' && matched.first_name && matched.last_name) continue;
    matched[target] = guessKey(fields, target, taken);
    if (matched[target]) taken.add(matched[target]!);
  }
  return matched;
};

// Same rule as the rest of the app: split at the last space.
const splitName = (full: string) => {
  const trimmed = full.trim().replace(/\s+/g, ' ');
  const at = trimmed.lastIndexOf(' ');
  return at === -1
    ? { first: trimmed, last: '' }
    : { first: trimmed.slice(0, at), last: trimmed.slice(at + 1) };
};

const parseMapping = (raw: unknown): Partial<Record<Target, string>> => {
  try {
    const parsed = JSON.parse(typeof raw === 'string' ? raw : '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
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

  const value = (target: Target) => (matched[target] ? fields[matched[target]!].trim() : '');
  let firstName = value('first_name');
  let lastName = value('last_name');
  // Fill whatever is missing from a full-name field ("Anna Maria Müller").
  if ((!firstName || !lastName) && value('full_name')) {
    const split = splitName(value('full_name'));
    firstName ||= split.first;
    lastName ||= firstName === split.first ? split.last : value('full_name');
  }
  const email = value('email') || null;
  const rawGroup = value('group_name');

  if (!firstName) {
    record('missing_name');
    return c.json({ ok: false, error: 'missing_name' }, 422);
  }
  if (firstName.length > 120 || lastName.length > 120 || (email ?? '').length > 200 || rawGroup.length > 120) {
    record('invalid_input');
    return c.json({ ok: false, error: 'invalid_input' }, 422);
  }

  // Match the project's groups ignoring case; unknown groups stay on the
  // registration for a manager to resolve and are never auto-transferred.
  const groups = projectGroupNames(page.project_id);
  const known = groups.find((g) => g.toLowerCase() === rawGroup.toLowerCase());
  const groupName = known ?? (rawGroup || null);
  const canTransfer = Boolean(page.auto_transfer) && (!rawGroup || Boolean(known));

  const memberId = db.transaction(() => {
    const id = canTransfer
      ? registrationToMember(page.project_id, firstName, lastName, groupName, email, null)
      : null;
    db.prepare(
      `insert into registrations
         (registration_page_id, first_name, last_name, email, group_name, member_id, transferred)
       values (?, ?, ?, ?, ?, ?, ?)`,
    ).run(page.id, firstName, lastName, email, groupName, id, id ? 1 : 0);
    record('ok');
    return id;
  })();

  return c.json({ ok: true, transferred: Boolean(memberId) });
});
