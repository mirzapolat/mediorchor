// Surveys and forms ("Umfragen") on the server: building and publishing
// (managers), answering (participants, accounts or guests, as the form
// allows), results, uploads and notices. shared/forms.ts holds the structure
// and the answer rules; this module enforces them.
//
// Privacy rules kept here:
//  - Respondents only ever receive the published version and its branding —
//    never members, project data or other people's answers (except the
//    optional summary, which never shows fewer than MIN_SUMMARY_RESPONSES).
//  - Anonymous responses store nothing about the respondent (no account,
//    name, email, invitation, edit link or time). Participation is a
//    separate receipt, so "one response per account" still works. Their
//    audit entry only says that a response came in (auditAnonymous), they
//    get no email copy and managers hear of them in digests only.
//  - No answer ever reaches the audit log, an error message or a notice.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { db, asUser, authUid, ApiError, forbidden, nowIso } from './db.ts';
import { env } from './env.ts';
import { requireSession, sessionUser } from './auth.ts';
import { bucketObjectPath, canAccessProject, isCanonicalKey, isProjectParticipant } from './policies.ts';
import { auditAnonymous, auditNote } from './audit.ts';
import { rateLimit } from './ratelimit.ts';
import { mailEnabled, mailErrorCode, sendMail } from './mail.ts';
import { accountLanguage, composeMail, mailLanguages } from './i18n.ts';
import { branding } from './branding.ts';
import { safeFileName, streamZip } from './pieceFiles.ts';
import {
  FILE_KIND_TYPES,
  MIN_SUMMARY_RESPONSES,
  answerText,
  checkStructure,
  checkSubmission,
  fileKindOf,
  formState,
  normalizeStructure,
  snapshotOf,
  structuralSignature,
  type Answers,
  type FormSnapshot,
  type FormState,
  type FormStructure,
} from '../shared/forms.ts';

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

interface FormRow {
  id: string;
  project_id: string;
  title: string;
  token: string;
  draft: string;
  draft_saved_at: string | null;
  version_id: string | null;
  status: 'draft' | 'published' | 'closed';
  opens_at: string | null;
  closes_at: string | null;
  max_responses: number | null;
  archived: number;
  listed: number;
  access: 'members' | 'accounts' | 'guests';
  identity: 'named' | 'confidential' | 'anonymous';
  guest_name: 'required' | 'optional' | 'off';
  guest_email: 'required' | 'optional' | 'off';
  one_per_account: number;
  allow_edit: number;
  guest_edit_link: number;
  review_before_submit: number;
  show_progress: number;
  email_copy: number;
  results_visibility: 'off' | 'after_submit' | 'after_close';
  consent_required: number;
  consent_text: string;
  notify_user_ids: string;
  notify_mode: 'off' | 'each' | 'daily';
  notify_sent_at: string | null;
  notify_sent_count: number;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface ResponseRow {
  id: string;
  form_id: string;
  version_id: string;
  answers: string;
  snapshot: string;
  user_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
  invite_id: string | null;
  edit_token_hash: string | null;
  submitted_at: string | null;
  updated_at: string | null;
  reviewed: string;
}

const BOOLEAN_FIELDS = [
  'archived',
  'listed',
  'one_per_account',
  'allow_edit',
  'guest_edit_link',
  'review_before_submit',
  'show_progress',
  'email_copy',
  'consent_required',
] as const;

const BUCKET = 'form-files';
const bucketDir = () => path.join(env.storageDir, BUCKET);

const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ids = (value: unknown): string[] => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const newSecret = (bytes = 18) => randomBytes(bytes).toString('base64url');
const today = () => nowIso().slice(0, 10);
const parse = <T>(json: string | null | undefined, fallback: T): T => {
  try {
    return json ? (JSON.parse(json) as T) : fallback;
  } catch {
    return fallback;
  }
};

const EMAIL = /^[^\s@<>"(),;:\\]+@[^\s@<>"(),;:\\]+\.[^\s@<>"(),;:\\]+$/;

const holds = (sql: string, params: Record<string, unknown> = {}) =>
  Boolean((db.prepare(`select (${sql}) as v`).get(params) as { v: number }).v);

const requireUser = () => {
  const uid = authUid();
  if (!uid) throw new ApiError('Authentication required', 401, '42501');
  return uid;
};

const isManagerOf = (projectId: string) => holds(canAccessProject('@pid'), { pid: projectId });

const requireProjectManager = (projectId: string) => {
  requireUser();
  if (!projectId || !isManagerOf(projectId)) throw forbidden('Project access denied');
};

const getForm = (id: string) => db.prepare('select * from forms where id = ?').get(id) as FormRow | undefined;

const requireManagedForm = (formId: string) => {
  requireUser();
  const form = getForm(formId);
  if (!form || !isManagerOf(form.project_id)) throw forbidden('Access denied');
  return form;
};

const responseCount = (formId: string) =>
  (db.prepare('select count(*) as n from form_responses where form_id = ?').get(formId) as { n: number }).n;

const stateOf = (form: FormRow, responses = responseCount(form.id)): FormState =>
  formState({ ...form, archived: Boolean(form.archived) }, responses);

const versionOf = (form: FormRow) =>
  form.version_id
    ? (db.prepare('select id, number, structure from form_versions where id = ?').get(form.version_id) as
        | { id: string; number: number; structure: string }
        | undefined)
    : undefined;

const draftOf = (form: FormRow) => normalizeStructure(parse(form.draft, {}));

// How the draft differs from what respondents see.
const changesOf = (form: FormRow, draft: FormStructure) => {
  const version = versionOf(form);
  if (!version) return 'unpublished';
  const published = normalizeStructure(parse(version.structure, {}));
  if (JSON.stringify(published) === JSON.stringify(draft)) return 'none';
  return structuralSignature(published) === structuralSignature(draft) ? 'editorial' : 'structural';
};

// The settings as the app reads them (booleans, recipient list).
const settingsOf = (form: FormRow) => {
  const out: Row = { ...form, notify_user_ids: parse<string[]>(form.notify_user_ids, []) };
  for (const field of BOOLEAN_FIELDS) out[field] = Boolean(form[field]);
  delete out.draft;
  return out;
};

const userName = (uid: string | null) =>
  uid ? ((db.prepare('select name from app_users where id = ?').get(uid) as { name: string } | undefined)?.name ?? '') : '';

// ---------------------------------------------------------------------------
// Managing forms
// ---------------------------------------------------------------------------

const form_create = (args: Args) => {
  const uid = requireUser();
  const projectId = text(args.p_project_id);
  requireProjectManager(projectId);
  const title = text(args.p_title).trim().slice(0, 200);
  if (!title) throw new ApiError('A form needs a title', 400, '23514');
  const draft = normalizeStructure(args.p_structure);
  const { id } = db
    .prepare('insert into forms (project_id, title, token, draft, created_by) values (?, ?, ?, ?, ?) returning id')
    .get(projectId, title, newSecret(), JSON.stringify(draft), uid) as { id: string };
  return { id };
};

// A copy as a new draft: the settings and the current draft, a new link,
// no responses.
const form_duplicate = (args: Args) => {
  const uid = requireUser();
  const source = requireManagedForm(text(args.p_form_id));
  const copied = [
    'listed',
    'access',
    'identity',
    'guest_name',
    'guest_email',
    'one_per_account',
    'allow_edit',
    'guest_edit_link',
    'review_before_submit',
    'show_progress',
    'email_copy',
    'results_visibility',
    'consent_required',
    'consent_text',
    'notify_user_ids',
    'notify_mode',
    'max_responses',
  ] as const;
  const title = `${source.title} (${text(args.p_suffix).trim().slice(0, 40) || 'copy'})`.slice(0, 200);
  const { id } = db
    .prepare(
      `insert into forms (project_id, title, token, draft, created_by, ${copied.join(', ')})
       values (?, ?, ?, ?, ?, ${copied.map(() => '?').join(', ')}) returning id`,
    )
    .get(source.project_id, title, newSecret(), source.draft, uid, ...copied.map((c) => source[c])) as { id: string };
  return { id };
};

// Autosave of the builder: the draft only; respondents keep seeing the
// published version until it is published again.
const form_save_draft = (args: Args) => {
  const form = requireManagedForm(text(args.p_form_id));
  if (JSON.stringify(args.p_draft ?? {}).length > 500_000) throw new ApiError('The form is too large', 413);
  const draft = normalizeStructure(args.p_draft);
  const savedAt = nowIso();
  db.prepare('update forms set draft = ?, draft_saved_at = ?, updated_at = ? where id = ?').run(
    JSON.stringify(draft),
    savedAt,
    savedAt,
    form.id,
  );
  return { saved_at: savedAt, problems: checkStructure(draft), changes: changesOf(form, draft) };
};

// Publishing: wording-only changes correct the current version in place;
// anything else becomes a new, immutable version (earlier responses keep
// theirs).
const form_publish = (args: Args) => {
  const uid = requireUser();
  const form = requireManagedForm(text(args.p_form_id));
  const draft = draftOf(form);
  if (checkStructure(draft).length) throw new ApiError('The form still has problems', 400, 'form_problems');
  const version = versionOf(form);
  const now = nowIso();
  let number: number;
  let newVersion = false;
  if (version && structuralSignature(normalizeStructure(parse(version.structure, {}))) === structuralSignature(draft)) {
    db.prepare('update form_versions set structure = ? where id = ?').run(JSON.stringify(draft), version.id);
    number = version.number;
  } else {
    number =
      ((db.prepare('select max(number) as n from form_versions where form_id = ?').get(form.id) as { n: number | null }).n ?? 0) + 1;
    const { id } = db
      .prepare(
        'insert into form_versions (form_id, number, structure, created_by_name) values (?, ?, ?, ?) returning id',
      )
      .get(form.id, number, JSON.stringify(draft), userName(uid)) as { id: string };
    db.prepare('update forms set version_id = ? where id = ?').run(id, form.id);
    newVersion = Boolean(version);
  }
  db.prepare(
    `update forms set status = case when status = 'draft' then 'published' else status end,
       published_at = coalesce(published_at, ?), updated_at = ? where id = ?`,
  ).run(now, now, form.id);
  auditNote({ action: 'forms.publish', details: { version: number } });
  return { version: number, new_version: newVersion, state: stateOf(getForm(form.id)!) };
};

// Unpublish (back to a draft: the link stops working), close, reopen,
// archive and restore — all by hand.
const form_set_state = (args: Args) => {
  const form = requireManagedForm(text(args.p_form_id));
  const action = text(args.p_action);
  const now = nowIso();
  switch (action) {
    case 'unpublish':
      db.prepare(`update forms set status = 'draft', updated_at = ? where id = ?`).run(now, form.id);
      break;
    case 'close':
      if (form.status === 'draft') throw new ApiError('Publish the form first', 400);
      db.prepare(`update forms set status = 'closed', updated_at = ? where id = ?`).run(now, form.id);
      break;
    case 'reopen':
      if (!form.version_id) throw new ApiError('Publish the form first', 400);
      // A deadline already passed would close it again at once.
      db.prepare(
        `update forms set status = 'published', updated_at = ?,
           closes_at = case when closes_at is not null and closes_at <= ? then null else closes_at end
         where id = ?`,
      ).run(now, now, form.id);
      break;
    case 'archive':
      db.prepare('update forms set archived = 1, updated_at = ? where id = ?').run(now, form.id);
      break;
    case 'restore':
      db.prepare('update forms set archived = 0, updated_at = ? where id = ?').run(now, form.id);
      break;
    default:
      throw new ApiError('Unknown action', 400);
  }
  return { state: stateOf(getForm(form.id)!) };
};

// A new link; the old one stops working at once.
const form_rotate_link = (args: Args) => {
  const form = requireManagedForm(text(args.p_form_id));
  const token = newSecret();
  db.prepare('update forms set token = ?, updated_at = ? where id = ?').run(token, nowIso(), form.id);
  return { token };
};

// The project's forms for its managers.
const form_overview = (args: Args) => {
  const projectId = text(args.p_project_id);
  requireProjectManager(projectId);
  const rows = db
    .prepare(
      `select f.*, (select count(*) from form_responses r where r.form_id = f.id) as responses,
              (select number from form_versions v where v.id = f.version_id) as version_number
       from forms f where f.project_id = ? order by f.created_at desc`,
    )
    .all(projectId) as Array<FormRow & { responses: number; version_number: number | null }>;
  return rows.map((f) => ({
    id: f.id,
    title: f.title,
    token: f.token,
    state: stateOf(f, f.responses),
    listed: Boolean(f.listed),
    access: f.access,
    identity: f.identity,
    opens_at: f.opens_at,
    closes_at: f.closes_at,
    max_responses: f.max_responses,
    responses: f.responses,
    version_number: f.version_number,
    changes: changesOf(f, draftOf(f)),
    updated_at: f.updated_at,
  }));
};

// Everything the builder and the form's pages need.
const form_detail = (args: Args) => {
  const form = requireManagedForm(text(args.p_form_id));
  const draft = draftOf(form);
  const version = versionOf(form);
  const responses = responseCount(form.id);
  const project = db.prepare('select name, image_url from projects where id = ?').get(form.project_id) as
    | { name: string; image_url: string | null }
    | undefined;
  return {
    form: settingsOf(form),
    draft,
    problems: checkStructure(draft),
    changes: changesOf(form, draft),
    version: version ? { id: version.id, number: version.number, structure: normalizeStructure(parse(version.structure, {})) } : null,
    versions: db
      .prepare('select id, number, created_by_name, created_at from form_versions where form_id = ? order by number desc')
      .all(form.id),
    state: stateOf(form, responses),
    responses,
    receipts: (db.prepare('select count(*) as n from form_receipts where form_id = ?').get(form.id) as { n: number }).n,
    invites: db
      .prepare('select count(*) as total, count(used_at) as used from form_invites where form_id = ?')
      .get(form.id),
    // Who can be told about new responses.
    managers: db
      .prepare(
        `select id, name, email, photo_url from app_users
         where role in ('section_lead', 'manager', 'music_director', 'admin') order by name collate nocase`,
      )
      .all(),
    mail_enabled: mailEnabled(),
    project_image: project?.image_url ?? null,
  };
};

// Who sent a named response.
const respondentOf = (r: ResponseRow) => {
  if (r.user_id) {
    const u = db.prepare('select name, email, photo_url from app_users where id = ?').get(r.user_id) as Row | undefined;
    return { kind: 'account', name: text(u?.name), email: text(u?.email), photo_url: u?.photo_url ?? null };
  }
  if (r.invite_id) {
    const i = db.prepare('select label, email from form_invites where id = ?').get(r.invite_id) as Row | undefined;
    return { kind: 'invite', name: text(i?.label), email: (i?.email as string | null) ?? null, photo_url: null };
  }
  return { kind: 'guest', name: r.guest_name ?? '', email: r.guest_email, photo_url: null };
};

// The responses as the identity mode allows: named with who and when;
// confidential and anonymous without either, in no meaningful order.
// Participation (who answered, who not yet) comes separately — for
// anonymous forms only as a number.
const form_results = (args: Args) => {
  const form = requireManagedForm(text(args.p_form_id));
  const named = form.identity === 'named';
  const rows = db
    .prepare(`select * from form_responses where form_id = ? order by ${named ? 'submitted_at' : 'id'}`)
    .all(form.id) as ResponseRow[];
  const responses = rows.map((r) => ({
    id: r.id,
    version_id: r.version_id,
    answers: parse<Answers>(r.answers, {}),
    snapshot: parse<FormSnapshot>(r.snapshot, {}),
    reviewed: parse<string[]>(r.reviewed, []),
    ...(named ? { submitted_at: r.submitted_at, updated_at: r.updated_at, respondent: respondentOf(r) } : {}),
  }));
  const versions = db
    .prepare('select id, number, structure from form_versions where form_id = ? order by number')
    .all(form.id)
    .map((v) => {
      const row = v as { id: string; number: number; structure: string };
      return { id: row.id, number: row.number, structure: normalizeStructure(parse(row.structure, {})) };
    });
  const files = db
    .prepare(
      `select id, response_id, item_id, file_name, mime, size from form_files
       where form_id = ? and response_id is not null`,
    )
    .all(form.id);

  let participation: Row;
  if (form.identity === 'anonymous') {
    participation = {
      count: (db.prepare('select count(*) as n from form_receipts where form_id = ?').get(form.id) as { n: number }).n,
    };
  } else {
    const responded = db
      .prepare(
        `select r.created_at as at, r.user_id, u.name, u.email, u.photo_url, i.label as invite_label, i.email as invite_email
         from form_receipts r
         left join app_users u on u.id = r.user_id
         left join form_invites i on i.id = r.invite_id
         where r.form_id = ? order by r.created_at`,
      )
      .all(form.id);
    // Still to answer: the project's active participants with an account
    // (only meaningful when the form is for them).
    const pending =
      form.access === 'members'
        ? db
            .prepare(
              `select m.id as member_id, m.first_name, m.last_name, m.group_name, m.photo_url, (m.user_id is not null) as has_account
               from members m
               where m.project_id = ? and m.status = 'active'
                 and (m.user_id is null or not exists (
                   select 1 from form_receipts r where r.form_id = ? and r.user_id = m.user_id))
               order by m.last_name collate nocase, m.first_name collate nocase`,
            )
            .all(form.project_id, form.id)
            .map((m) => ({ ...(m as Row), has_account: Boolean((m as Row).has_account) }))
        : null;
    participation = { responded, pending };
  }
  return { identity: form.identity, title: form.title, responses, versions, files, participation };
};

// Marks a free-text answer as checked (or not) — internal only.
const form_review = (args: Args) => {
  const row = db.prepare('select form_id, reviewed from form_responses where id = ?').get(text(args.p_response_id)) as
    | { form_id: string; reviewed: string }
    | undefined;
  if (!row) throw new ApiError('Response not found', 404);
  requireManagedForm(row.form_id);
  const itemId = text(args.p_item_id).slice(0, 40);
  const reviewed = new Set(parse<string[]>(row.reviewed, []));
  if (args.p_reviewed === true) reviewed.add(itemId);
  else reviewed.delete(itemId);
  db.prepare('update form_responses set reviewed = ? where id = ?').run(JSON.stringify([...reviewed]), text(args.p_response_id));
  return { reviewed: [...reviewed] };
};

const removeObjects = (keys: string[]) => {
  for (const key of keys) {
    const file = bucketObjectPath(BUCKET, key);
    if (!file) continue;
    try {
      fs.unlinkSync(file);
    } catch {
      /* already gone */
    }
  }
};

// Deletes responses (after a confirmation in the app): with their files,
// and — where a response names its account or invitation — the receipt, so
// that person may answer again.
const form_delete_responses = (args: Args) => {
  const form = requireManagedForm(text(args.p_form_id));
  const chosen =
    args.p_all === true
      ? (db.prepare('select id from form_responses where form_id = ?').all(form.id) as { id: string }[]).map((r) => r.id)
      : ids(args.p_ids);
  const keys: string[] = [];
  let deleted = 0;
  for (const id of chosen) {
    const r = db.prepare('select * from form_responses where id = ? and form_id = ?').get(id, form.id) as ResponseRow | undefined;
    if (!r) continue;
    for (const f of db.prepare('select file_path from form_files where response_id = ?').all(id) as { file_path: string }[]) {
      keys.push(f.file_path);
    }
    db.prepare('delete from form_files where response_id = ?').run(id);
    if (r.user_id) db.prepare('delete from form_receipts where form_id = ? and subject = ?').run(form.id, `u:${r.user_id}`);
    if (r.invite_id) {
      db.prepare('delete from form_receipts where form_id = ? and subject = ?').run(form.id, `i:${r.invite_id}`);
      db.prepare('update form_invites set used_at = null where id = ?').run(r.invite_id);
    }
    db.prepare('delete from form_responses where id = ?').run(id);
    deleted++;
  }
  const left = responseCount(form.id);
  db.prepare('update forms set notify_sent_count = min(notify_sent_count, ?) where id = ?').run(left, form.id);
  auditNote({ action: 'forms.delete_responses', details: { deleted } });
  setImmediate(() => removeObjects(keys));
  return { deleted };
};

// Personal one-time links (for guests): a name or label and an optional
// email each; the CSV with the links is made in the app.
const form_invites_create = (args: Args) => {
  const form = requireManagedForm(text(args.p_form_id));
  const rows = (Array.isArray(args.p_rows) ? args.p_rows : []).slice(0, 1000);
  const insert = db.prepare('insert into form_invites (form_id, token, label, email) values (?, ?, ?, ?) returning id, token, label, email, used_at, created_at');
  const created: Row[] = [];
  for (const raw of rows) {
    if (!isObj(raw)) continue;
    const label = text(raw.label).trim().slice(0, 120);
    const email = text(raw.email).trim().toLowerCase().slice(0, 254) || null;
    if (!label && !email) continue;
    if (email && !EMAIL.test(email)) throw new ApiError(`Invalid email: ${email}`, 400, 'invalid_email');
    created.push(insert.get(form.id, newSecret(), label, email) as Row);
  }
  return created;
};

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

interface Granted {
  ok: true;
  form: FormRow;
  version: { id: string; number: number };
  structure: FormStructure;
  state: FormState;
  uid: string | null;
  mode: 'account' | 'guest' | 'invite';
  invite: { id: string; label: string; email: string | null; used_at: string | null } | null;
  // The response being changed (an account allowed to edit, a guest's
  // edit link).
  editing: ResponseRow | null;
  // Taken part already and can't change it.
  answered: boolean;
}

interface Denied {
  ok: false;
  state: 'invalid' | 'login_required' | 'not_allowed';
  title?: string;
}

// Who may open this form, as what — the same answer for showing, drafting,
// uploading and sending. Respondents of a members-only form are the
// project's active participants; managers look at forms through the
// builder's preview instead.
const resolve = (args: Args): Granted | Denied => {
  const form = db.prepare('select * from forms where token = ?').get(text(args.p_token)) as FormRow | undefined;
  if (!form || form.status === 'draft' || form.archived || !form.version_id) return { ok: false, state: 'invalid' };
  const version = versionOf(form);
  if (!version) return { ok: false, state: 'invalid' };
  const structure = normalizeStructure(parse(version.structure, {}));
  const state = stateOf(form);
  const uid = authUid();
  const base = { ok: true as const, form, version: { id: version.id, number: version.number }, structure, state, uid };

  const inviteToken = text(args.p_invite);
  if (inviteToken) {
    const invite = db
      .prepare('select id, label, email, used_at from form_invites where token = ? and form_id = ?')
      .get(inviteToken, form.id) as Granted['invite'] | undefined;
    if (!invite) return { ok: false, state: 'invalid', title: form.title };
    return { ...base, mode: 'invite', invite, editing: null, answered: Boolean(invite.used_at) };
  }

  const editToken = text(args.p_edit);
  if (editToken) {
    if (!form.guest_edit_link || form.identity === 'anonymous') return { ok: false, state: 'invalid', title: form.title };
    const editing = db
      .prepare('select * from form_responses where form_id = ? and edit_token_hash = ?')
      .get(form.id, sha256(editToken)) as ResponseRow | undefined;
    if (!editing) return { ok: false, state: 'invalid', title: form.title };
    return { ...base, mode: 'guest', invite: null, editing, answered: false };
  }

  if (!uid) {
    if (form.access === 'guests') return { ...base, mode: 'guest', invite: null, editing: null, answered: false };
    return { ok: false, state: 'login_required', title: form.title };
  }
  if (form.access === 'members' && !holds(isProjectParticipant('@pid'), { pid: form.project_id })) {
    return { ok: false, state: 'not_allowed', title: form.title };
  }
  let editing: ResponseRow | null = null;
  let answered = false;
  if (form.one_per_account) {
    const receipt = db.prepare('select 1 from form_receipts where form_id = ? and subject = ?').get(form.id, `u:${uid}`);
    if (receipt) {
      if (form.allow_edit && form.identity !== 'anonymous') {
        editing =
          (db
            .prepare('select * from form_responses where form_id = ? and user_id = ? order by submitted_at desc limit 1')
            .get(form.id, uid) as ResponseRow | undefined) ?? null;
      }
      answered = !editing;
    }
  }
  return { ...base, mode: 'account', invite: null, editing, answered };
};

// Answer counts per choice for the optional participant summary: only
// choice-like questions, never free text, files, names or times, and
// nothing while there are fewer than MIN_SUMMARY_RESPONSES responses.
const summaryOf = (form: FormRow, structure: FormStructure) => {
  const rows = db.prepare('select answers from form_responses where form_id = ?').all(form.id) as { answers: string }[];
  const total = rows.length;
  if (total < MIN_SUMMARY_RESPONSES) return { total, too_few: true, min: MIN_SUMMARY_RESPONSES, items: [] };
  const all = rows.map((r) => parse<Answers>(r.answers, {}));
  const items = structure.items
    .filter((i) => ['single', 'multi', 'dropdown', 'yesno', 'scale', 'stars', 'grid'].includes(i.type))
    .map((item) => {
      const counts: Record<string, number> = {};
      let answered = 0;
      for (const answers of all) {
        const value = answers[item.id];
        if (value === undefined || value === null) continue;
        answered++;
        const add = (key: string) => (counts[key] = (counts[key] ?? 0) + 1);
        if (Array.isArray(value)) value.forEach((v) => add(String(v)));
        else if (isObj(value)) Object.entries(value).forEach(([row, column]) => add(`${row}:${column}`));
        else add(String(value));
      }
      return {
        id: item.id,
        type: item.type,
        title: item.title,
        options: item.options?.map(({ id, label }) => ({ id, label })),
        rows: item.rows,
        columns: item.columns,
        scale_min: item.scale_min,
        scale_max: item.scale_max,
        min_label: item.min_label,
        max_label: item.max_label,
        answered,
        counts,
      };
    });
  return { total, too_few: false, min: MIN_SUMMARY_RESPONSES, items };
};

const resultsOpenFor = (g: Granted, submittedNow = false) => {
  const mode = g.form.results_visibility;
  if (mode === 'after_close') return g.state === 'closed';
  if (mode === 'after_submit') return submittedNow || g.answered || g.editing != null || g.state === 'closed';
  return false;
};

const accountEmail = (uid: string) =>
  (db.prepare('select email from auth_users where id = ?').get(uid) as { email: string } | undefined)?.email ?? null;

// Where the copy of a response may go: an account's verified address or a
// personal invitation's — never an address typed into a public form.
const copyTarget = (g: Granted) => {
  if (!g.form.email_copy || g.form.identity === 'anonymous' || !mailEnabled()) return null;
  if (g.mode === 'account' && g.uid) return accountEmail(g.uid);
  if (g.mode === 'invite') return g.invite?.email ?? null;
  return null;
};

// What a respondent's page receives: the published version, its branding
// and the rules that apply to them — nothing about the project or others.
const get_form = (args: Args) => {
  const g = resolve(args);
  if (!g.ok) return g;
  const { form, structure } = g;
  const base = {
    title: form.title,
    image_url: structure.settings.image_url,
    accent: structure.settings.accent,
    opens_at: form.opens_at,
    closes_at: form.closes_at,
    identity: form.identity,
  };
  const summary = resultsOpenFor(g) ? summaryOf(form, structure) : null;
  if (g.state === 'scheduled') return { state: 'scheduled', form: base };
  if (g.state === 'closed') return { state: 'closed', form: base, summary };
  if (g.answered) {
    return { state: 'answered', form: base, summary, can_edit: false };
  }
  const me =
    g.mode === 'account' && g.uid
      ? (db.prepare('select name, email from app_users where id = ?').get(g.uid) as { name: string; email: string })
      : null;
  const draft =
    g.mode === 'account' && g.uid && !g.editing && form.identity !== 'anonymous'
      ? (db.prepare('select answers, page, updated_at from form_drafts where form_id = ? and user_id = ?').get(form.id, g.uid) as
          | { answers: string; page: number; updated_at: string }
          | undefined)
      : undefined;
  const editingFiles = g.editing
    ? db.prepare('select id, item_id, file_name, size from form_files where response_id = ?').all(g.editing.id)
    : [];
  const target = copyTarget(g);
  return {
    state: 'open',
    form: {
      ...base,
      structure,
      access: form.access,
      guest_name: form.guest_name,
      guest_email: form.guest_email,
      review_before_submit: Boolean(form.review_before_submit),
      show_progress: Boolean(form.show_progress),
      consent_required: Boolean(form.consent_required),
      consent_text: form.consent_text,
      results_visibility: form.results_visibility,
      one_per_account: Boolean(form.one_per_account),
      allow_edit: Boolean(form.allow_edit) && form.identity !== 'anonymous' && Boolean(form.one_per_account),
      guest_edit_link: Boolean(form.guest_edit_link) && form.identity !== 'anonymous',
      copy_to: target,
    },
    mode: g.mode,
    me,
    invite: g.invite ? { label: g.invite.label } : null,
    draft: draft ? { answers: parse<Answers>(draft.answers, {}), page: draft.page, updated_at: draft.updated_at } : null,
    editing: g.editing ? { answers: parse<Answers>(g.editing.answers, {}), files: editingFiles } : null,
    summary,
  };
};

// An account's unsent answers, so they survive a reload or another device
// (not for anonymous forms, whose drafts stay in the browser).
const save_form_draft = (args: Args) => {
  const g = resolve(args);
  if (!g.ok || g.mode !== 'account' || !g.uid || g.editing || g.answered || g.state !== 'open') {
    throw new ApiError('Not possible here', 400, 'no_draft');
  }
  if (g.form.identity === 'anonymous') throw new ApiError('Not possible here', 400, 'no_draft');
  const answers = isObj(args.p_answers) ? args.p_answers : {};
  const json = JSON.stringify(answers);
  if (json.length > 200_000) throw new ApiError('Too large', 413);
  db.prepare(
    `insert into form_drafts (form_id, user_id, answers, page, updated_at) values (?, ?, ?, ?, ?)
     on conflict (form_id, user_id) do update set answers = excluded.answers, page = excluded.page, updated_at = excluded.updated_at`,
  ).run(g.form.id, g.uid, json, Math.max(0, Math.min(500, Math.trunc(Number(args.p_page) || 0))), nowIso());
  return { saved_at: nowIso() };
};

const submit_form = (args: Args) => {
  // Bots: a filled hidden field or an inhumanly fast form get a friendly
  // reply and nothing is stored.
  if (text(args.p_website) || Number(args.p_elapsed_ms) < 1500) return { state: 'success', confirmation: '' };
  const g = resolve(args);
  if (!g.ok) return g;
  const { form, structure, version } = g;
  if (g.state !== 'open') return { state: g.state };
  if (g.answered) return { state: 'answered' };
  const anonymous = form.identity === 'anonymous';

  if (!isObj(args.p_answers) || JSON.stringify(args.p_answers).length > 200_000) return { state: 'invalid_answers', problems: {} };
  const { answers, problems } = checkSubmission(structure, args.p_answers as Answers);
  if (Object.keys(problems).length) return { state: 'invalid_answers', problems };

  // A guest's name and email, as the form asks for them (never stored for
  // anonymous forms).
  let guestName: string | null = null;
  let guestEmail: string | null = null;
  if (g.mode === 'guest' && !g.editing && !anonymous) {
    guestName = form.guest_name === 'off' ? null : text(args.p_guest_name).trim().slice(0, 200) || null;
    guestEmail = form.guest_email === 'off' ? null : text(args.p_guest_email).trim().toLowerCase().slice(0, 254) || null;
    if (form.guest_name === 'required' && !guestName) return { state: 'invalid_guest', field: 'name' };
    if (form.guest_email === 'required' && !guestEmail) return { state: 'invalid_guest', field: 'email' };
    if (guestEmail && !EMAIL.test(guestEmail)) return { state: 'invalid_guest', field: 'email' };
  }
  if (form.consent_required && args.p_consent !== true) return { state: 'consent_required' };

  // Files: each must have been uploaded for this question by this person
  // (its secret), or already belong to the response being changed.
  const secrets = isObj(args.p_files) ? args.p_files : {};
  const fileIds: string[] = [];
  for (const item of structure.items.filter((i) => i.type === 'file')) {
    for (const fileId of (answers[item.id] as string[] | undefined) ?? []) {
      const row = db.prepare('select * from form_files where id = ? and form_id = ?').get(fileId, form.id) as Row | undefined;
      const mine =
        row &&
        row.item_id === item.id &&
        ((row.response_id == null && sha256(text(secrets[fileId])) === row.secret_hash) ||
          (g.editing != null && row.response_id === g.editing.id));
      if (!mine) return { state: 'invalid_files' };
      fileIds.push(fileId);
    }
  }

  const now = nowIso();
  const snapshot = JSON.stringify(snapshotOf(structure, answers));
  let responseId: string;
  let editToken: string | null = null;
  if (g.editing) {
    responseId = g.editing.id;
    db.prepare(
      'update form_responses set answers = ?, snapshot = ?, version_id = ?, updated_at = ? where id = ?',
    ).run(JSON.stringify(answers), snapshot, version.id, anonymous ? null : now, responseId);
  } else {
    responseId = randomUUID();
    if (g.mode === 'guest' && form.guest_edit_link && !anonymous) editToken = newSecret(24);
    db.prepare(
      `insert into form_responses
         (id, form_id, version_id, answers, snapshot, user_id, guest_name, guest_email, invite_id, edit_token_hash,
          submitted_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      responseId,
      form.id,
      version.id,
      JSON.stringify(answers),
      snapshot,
      anonymous || g.mode !== 'account' ? null : g.uid,
      guestName,
      guestEmail,
      anonymous ? null : (g.invite?.id ?? null),
      editToken ? sha256(editToken) : null,
      anonymous ? null : now,
      anonymous ? null : now,
    );
    // Taking part, kept apart from the answer.
    if (g.mode === 'account' && g.uid) {
      db.prepare(
        'insert or ignore into form_receipts (form_id, subject, user_id, created_at) values (?, ?, ?, ?)',
      ).run(form.id, `u:${g.uid}`, g.uid, anonymous ? today() : now);
      db.prepare('delete from form_drafts where form_id = ? and user_id = ?').run(form.id, g.uid);
    }
    if (g.invite) {
      db.prepare(
        'insert or ignore into form_receipts (form_id, subject, invite_id, created_at) values (?, ?, ?, ?)',
      ).run(form.id, `i:${g.invite.id}`, g.invite.id, anonymous ? today() : now);
      db.prepare('update form_invites set used_at = ? where id = ?').run(anonymous ? today() : now, g.invite.id);
    }
  }

  // Files: attach the new ones, drop those a change removed.
  const dropped = db
    .prepare('select id, file_path from form_files where response_id = ?')
    .all(responseId)
    .filter((f) => !fileIds.includes((f as { id: string }).id)) as { id: string; file_path: string }[];
  for (const f of dropped) db.prepare('delete from form_files where id = ?').run(f.id);
  for (const fileId of fileIds) db.prepare('update form_files set response_id = ? where id = ?').run(responseId, fileId);
  setImmediate(() => removeObjects(dropped.map((f) => f.file_path)));

  if (anonymous) auditAnonymous('forms.anonymous_response');
  else auditNote({ action: g.editing ? 'forms.response_changed' : 'forms.response', target: form.title, force: true });

  const copyTo = args.p_copy === true ? copyTarget(g) : null;
  if (copyTo) queueCopy(copyTo, g.mode === 'account' ? g.uid : null, form.title, structure, answers);
  if (!g.editing) queueResponseNotice(form.id);

  return {
    state: 'success',
    confirmation: structure.settings.confirmation,
    confirmation_url: structure.settings.confirmation_url,
    confirmation_url_label: structure.settings.confirmation_url_label,
    edit_token: editToken,
    summary: resultsOpenFor(g, true) ? summaryOf(form, structure) : null,
  };
};

// The participant summary, when the form shows one to this person now.
const form_summary = (args: Args) => {
  const g = resolve(args);
  if (!g.ok) return null;
  return resultsOpenFor(g) ? summaryOf(g.form, g.structure) : null;
};

// The listed forms of a project for its participants, with their own state.
const project_forms = (args: Args) => {
  const uid = requireUser();
  const projectId = text(args.p_project_id);
  const manager = isManagerOf(projectId);
  if (!manager && !holds(isProjectParticipant('@pid'), { pid: projectId })) throw forbidden('Access denied');
  const rows = db
    .prepare(
      `select f.* from forms f where f.project_id = ? and f.listed and f.status <> 'draft' and not f.archived
         and f.version_id is not null order by coalesce(f.closes_at, '9999') , f.created_at desc`,
    )
    .all(projectId) as FormRow[];
  return rows.map((f) => ({
    id: f.id,
    title: f.title,
    token: f.token,
    state: stateOf(f),
    opens_at: f.opens_at,
    closes_at: f.closes_at,
    identity: f.identity,
    my: myStatus(f.id, uid),
  }));
};

const myStatus = (formId: string, uid: string): 'none' | 'draft' | 'answered' => {
  if (db.prepare('select 1 from form_receipts where form_id = ? and subject = ?').get(formId, `u:${uid}`)) return 'answered';
  if (db.prepare('select 1 from form_drafts where form_id = ? and user_id = ?').get(formId, uid)) return 'draft';
  return 'none';
};

// Listed, open forms across the account's projects (for the dashboard and
// the navigation badges): metadata and its own state only.
export const openFormsFor = (uid: string, projectId?: string) => {
  const rows = db
    .prepare(
      `select f.*, p.name as project_name, p.image_url as project_image,
              (select count(*) from form_responses r where r.form_id = f.id) as responses
       from forms f join projects p on p.id = f.project_id
       where f.listed and f.status = 'published' and not f.archived and f.version_id is not null
         and p.status = 'active' and p.allow_account_access
         and exists (select 1 from members m where m.project_id = f.project_id and m.user_id = @uid and m.status = 'active')
         ${projectId ? 'and f.project_id = @pid' : ''}`,
    )
    .all({ uid, pid: projectId ?? null }) as Array<FormRow & { project_name: string; project_image: string | null; responses: number }>;
  return rows
    .filter((f) => stateOf(f, f.responses) === 'open')
    .map((f) => {
      const receipt = db
        .prepare('select created_at from form_receipts where form_id = ? and subject = ?')
        .get(f.id, `u:${uid}`) as { created_at: string } | undefined;
      return {
        form_id: f.id,
        token: f.token,
        title: f.title,
        closes_at: f.closes_at,
        project: { id: f.project_id, name: f.project_name, image_url: f.project_image },
        my: receipt ? ('answered' as const) : myStatus(f.id, uid),
        answered_at: receipt?.created_at ?? null,
      };
    });
};

// ---------------------------------------------------------------------------
// Emails (after the transaction: a failed send never undoes a response)
// ---------------------------------------------------------------------------

const later = (label: string, send: () => Promise<void>) =>
  setImmediate(() => {
    send().catch((err) => console.error(`Sending the survey ${label} failed:`, mailErrorCode(err)));
  });

const appName = () => branding().appName;

const queueCopy = (to: string, uid: string | null, title: string, structure: FormStructure, answers: Answers) => {
  later('copy', async () => {
    if (!mailEnabled()) return;
    const snapshot = snapshotOf(structure, answers);
    const { subject, text: body } = composeMail(
      mailLanguages(accountLanguage(uid)),
      (m) =>
        m.formCopy(
          title,
          structure.items
            .filter((i) => i.id in answers)
            .map((i) => {
              const value = answerText(snapshot[i.id], answers[i.id], { yes: m.formYes, no: m.formNo, files: m.formFiles });
              return `${i.title}: ${value.length > 500 ? `${value.slice(0, 500)}…` : value}`;
            }),
        ),
      (m) => m.autoSent,
    );
    await sendMail(to, `${appName()}: ${subject}`, body, 'confirmation');
  });
};

const formLink = (form: { id: string; project_id: string }) =>
  env.publicUrl ? `${env.publicUrl}/projects/${form.project_id}/surveys/${form.id}` : null;

// Recipients still allowed to see the form's results.
const noticeRecipients = (form: FormRow) =>
  parse<string[]>(form.notify_user_ids, [])
    .map((id) =>
      db
        .prepare(
          `select u.id, a.email from app_users u join auth_users a on a.id = u.id
           where u.id = ? and u.role in ('section_lead', 'manager', 'music_director', 'admin')`,
        )
        .get(id) as { id: string; email: string } | undefined,
    )
    .filter((r): r is { id: string; email: string } => Boolean(r));

// "Each response" notices; anonymous forms only send digests (a notice
// right after a response would tell when it came in).
const queueResponseNotice = (formId: string) => {
  later('notice', async () => {
    const form = getForm(formId);
    if (!form || form.notify_mode !== 'each' || form.identity === 'anonymous' || !mailEnabled()) return;
    const total = responseCount(form.id);
    for (const r of noticeRecipients(form)) {
      const { subject, text: body } = composeMail(
        mailLanguages(accountLanguage(r.id)),
        (m) => m.formResponseNotice(form.title, total, formLink(form)),
        (m) => m.autoSent,
      );
      await sendMail(r.email, `${appName()}: ${subject}`, body, 'status');
    }
    db.prepare('update forms set notify_sent_count = ? where id = ?').run(total, form.id);
  });
};

// Daily digests: how many responses came in since the last one.
export const runFormDigests = async () => {
  if (!mailEnabled()) return;
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const forms = db
    .prepare(
      `select * from forms where (notify_mode = 'daily' or (notify_mode = 'each' and identity = 'anonymous'))
         and (notify_sent_at is null or notify_sent_at < ?)`,
    )
    .all(dayAgo) as FormRow[];
  for (const form of forms) {
    const total = responseCount(form.id);
    const added = total - form.notify_sent_count;
    if (added <= 0) continue;
    for (const r of noticeRecipients(form)) {
      const { subject, text: body } = composeMail(
        mailLanguages(accountLanguage(r.id)),
        (m) => m.formDigest(form.title, added, total, formLink(form)),
        (m) => m.autoSent,
      );
      try {
        await sendMail(r.email, `${appName()}: ${subject}`, body, 'status');
      } catch (err) {
        console.error('Sending a survey digest failed:', mailErrorCode(err));
      }
    }
    db.prepare('update forms set notify_sent_at = ?, notify_sent_count = ? where id = ?').run(nowIso(), total, form.id);
  }
};

// ---------------------------------------------------------------------------
// Files: upload (respondents), reading and ZIP (managers), maintenance
// ---------------------------------------------------------------------------

const INLINE = /^(image\/(png|jpeg|gif|webp)|audio\/|video\/|application\/pdf$)/;

const contentDisposition = (type: string, fileName: string) => {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
};

// The type a stored file is served as: one of the accepted kinds' types, else
// a plain download.
const servedType = (mime: string | null, fileName: string) => {
  const kind = fileKindOf(fileName);
  if (kind && mime && FILE_KIND_TYPES[kind].mimes.includes(mime)) return mime;
  return 'application/octet-stream';
};

export const formRoutes = new Hono();

// POST /api/forms/upload/<token>?item=<id>[&invite=…][&edit=…], raw body,
// file name in X-File-Name. Checked like an answer: the form must be open
// to this person, the question a file question accepting this kind and size.
formRoutes.post('/upload/:token', async (c) => {
  rateLimit(c, 'form-upload', 30, 60 * 1000);
  const user = sessionUser(c);
  let fileName = '';
  try {
    fileName = decodeURIComponent(c.req.header('x-file-name') ?? '').trim().slice(0, 200);
  } catch {
    throw new ApiError('Invalid file name', 400);
  }
  const kind = fileKindOf(fileName);
  const length = Number(c.req.header('content-length') ?? 0);
  const target = asUser(user?.id ?? null, () => {
    const g = resolve({ p_token: c.req.param('token'), p_invite: c.req.query('invite'), p_edit: c.req.query('edit') });
    if (!g.ok || g.state !== 'open' || g.answered) throw new ApiError('The form is not open', 403, 'form_closed');
    const item = g.structure.items.find((i) => i.id === c.req.query('item') && i.type === 'file');
    if (!item) throw new ApiError('Unknown question', 400);
    if (!kind || !item.accept?.includes(kind)) throw new ApiError('This file type is not accepted', 415, 'file_type');
    const max = Math.min((item.max_mb ?? 10) * 1024 * 1024, env.maxUploadBytes);
    if (length > max) throw new ApiError('The file is too large', 413, 'file_size');
    if (g.form.identity === 'anonymous') auditAnonymous('forms.anonymous_upload');
    else auditNote({ action: 'forms.upload', target: g.form.title, force: true });
    return { formId: g.form.id, itemId: item.id, max };
  });
  const data = Buffer.from(await c.req.arrayBuffer());
  if (data.length === 0) throw new ApiError('Empty file', 400);
  if (data.length > target.max) throw new ApiError('The file is too large', 413, 'file_size');
  const id = randomUUID();
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? 'bin';
  const key = `${target.formId}/${id}.${ext}`;
  const file = bucketObjectPath(BUCKET, key);
  if (!file) throw new ApiError('Invalid file', 400);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.promises.writeFile(temp, data);
  await fs.promises.rename(temp, file);
  const secret = newSecret();
  const mime = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase().slice(0, 100) || null;
  db.prepare(
    `insert into form_files (id, form_id, item_id, response_id, secret_hash, file_path, file_name, mime, size, created_on)
     values (?, ?, ?, null, ?, ?, ?, ?, ?, ?)`,
  ).run(id, target.formId, target.itemId, sha256(secret), key, fileName, mime, data.length, today());
  return c.json({ id, secret, name: fileName, size: data.length });
});

const managedFile = (uid: string, fileId: string) =>
  asUser(uid, () => {
    const row = db
      .prepare('select f.*, fo.project_id from form_files f join forms fo on fo.id = f.form_id where f.id = ?')
      .get(fileId) as (Row & { project_id: string; file_path: string; file_name: string; mime: string | null }) | undefined;
    if (!row || !row.response_id || !isManagerOf(row.project_id)) return null;
    return row;
  });

// GET /api/forms/file/<id>: a response's file, for the form's managers only.
// Never run in the browser: other types are downloads, and nothing may run
// script (sandbox).
formRoutes.get('/file/:id', async (c) => {
  const user = requireSession(c);
  const row = managedFile(user.id, c.req.param('id'));
  const file = row && isCanonicalKey(row.file_path) ? bucketObjectPath(BUCKET, row.file_path) : null;
  if (!row || !file || !fs.existsSync(file)) return c.json({ error: { message: 'Not found' } }, 404);
  const type = servedType(row.mime, row.file_name);
  const inline = INLINE.test(type) && c.req.query('download') === undefined;
  return new Response(fs.readFileSync(file), {
    headers: {
      'Content-Type': type,
      'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', row.file_name),
      'X-Content-Type-Options': 'nosniff',
      ...(type === 'application/pdf' ? {} : { 'Content-Security-Policy': "sandbox; default-src 'none'" }),
      'Cache-Control': 'private, no-store',
    },
  });
});

// GET /api/forms/zip/<formId>[?responses=a,b]: the files of these responses
// (else all), one folder per response.
formRoutes.get('/zip/:formId', async (c) => {
  const user = requireSession(c);
  const picked = asUser(user.id, () => {
    const form = getForm(c.req.param('formId'));
    if (!form || !isManagerOf(form.project_id)) throw new ApiError('Not found', 404);
    const wanted = (c.req.query('responses') ?? '').split(',').filter(Boolean).slice(0, 5000);
    const rows = db
      .prepare(
        `select f.file_path, f.file_name, f.item_id, f.response_id from form_files f
         where f.form_id = ? and f.response_id is not null order by f.response_id`,
      )
      .all(form.id) as { file_path: string; file_name: string; item_id: string; response_id: string }[];
    const chosen = wanted.length ? rows.filter((r) => wanted.includes(r.response_id)) : rows;
    const order = [...new Set(chosen.map((r) => r.response_id))];
    // Folders: the respondent's name where the form is named, else numbers.
    const folderOf = (responseId: string) => {
      if (form.identity === 'named') {
        const r = db.prepare('select * from form_responses where id = ?').get(responseId) as ResponseRow | undefined;
        const who = r ? respondentOf(r).name : '';
        return `${String(order.indexOf(responseId) + 1).padStart(3, '0')} ${safeFileName(who || 'Antwort')}`;
      }
      return String(order.indexOf(responseId) + 1).padStart(3, '0');
    };
    return {
      title: form.title,
      files: chosen
        .map((r) => ({ name: `${folderOf(r.response_id)}/${safeFileName(r.file_name)}`, file: bucketObjectPath(BUCKET, r.file_path) }))
        .filter((f): f is { name: string; file: string } => f.file != null),
    };
  });
  const used = new Set<string>();
  const files = picked.files.map((f) => {
    let name = f.name;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = f.name.replace(/(\.[^./]+)?$/, ` (${n})$1`);
    used.add(name.toLowerCase());
    return { ...f, name };
  });
  return streamZip(files, safeFileName(picked.title));
});

// Unattached uploads (a form never sent) go after a day, as do stored
// objects no row points at (deleted forms and responses).
export const runFormFileMaintenance = () => {
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const stale = db
    .prepare('select id, file_path from form_files where response_id is null and created_on < ?')
    .all(yesterday) as { id: string; file_path: string }[];
  db.transaction(() => {
    for (const f of stale) db.prepare('delete from form_files where id = ?').run(f.id);
  })();
  removeObjects(stale.map((f) => f.file_path));
  const referenced = new Set((db.prepare('select file_path from form_files').all() as { file_path: string }[]).map((r) => r.file_path));
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  let dirs: fs.Dirent[] = [];
  try {
    dirs = fs.readdirSync(bucketDir(), { withFileTypes: true });
  } catch {
    return { stale: stale.length };
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
      } catch {
        /* gone meanwhile */
      }
    }
  }
  return { stale: stale.length };
};

export const startFormJobs = () => {
  const files = () => {
    try {
      runFormFileMaintenance();
    } catch (err) {
      console.error('Survey file maintenance failed', err);
    }
  };
  const digests = () => {
    runFormDigests().catch((err) => console.error('Survey digests failed', err));
  };
  setTimeout(files, 4 * 60 * 1000).unref();
  setInterval(files, 6 * 60 * 60 * 1000).unref();
  setInterval(digests, 15 * 60 * 1000).unref();
};

// ---------------------------------------------------------------------------

export const formFunctions = {
  form_create,
  form_duplicate,
  form_save_draft,
  form_publish,
  form_set_state,
  form_rotate_link,
  form_overview,
  form_detail,
  form_results,
  form_review,
  form_delete_responses,
  form_invites_create,
  get_form,
  save_form_draft,
  submit_form,
  form_summary,
  project_forms,
};

// Work without a session (the form page) — rate limited when they write.
export const FORM_PUBLIC_FUNCTIONS = ['get_form', 'submit_form', 'form_summary'];
export const FORM_PUBLIC_WRITE_FUNCTIONS = ['submit_form'];
export const FORM_READ_FUNCTIONS = ['form_overview', 'form_detail', 'form_results', 'get_form', 'form_summary', 'project_forms'];
