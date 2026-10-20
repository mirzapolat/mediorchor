// Creating a project from the one-page onboarding: the project with its
// settings and everything prepared on the page — groups (with who looks
// after them), Proben, members, a first registration form, concerts, pieces
// and the audition rule — in one transaction (callFunction). Any problem
// rolls all of it back: no half-made project is ever visible; the creator's
// draft stays and the error names the section to fix.
import { db, authUid, ApiError, forbidden, nowIso } from './db.ts';
import { canManageProjects } from './policies.ts';
import { auditNote } from './audit.ts';

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const trimmed = (value: unknown, max: number) => text(value).trim().slice(0, max);
const isObj = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown, max = 1000): Row[] => (Array.isArray(v) ? v.slice(0, max).filter(isObj) : []);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const PHOTO = /^\/files\/photos\/[A-Za-z0-9._/-]+$/;
const EMAIL = /^[^\s@<>"(),;:\\]+@[^\s@<>"(),;:\\]+\.[^\s@<>"(),;:\\]+$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const SETTINGS = [
  'allow_account_access',
  'allow_participant_pieces',
  'show_surveys',
  'show_weekend',
  'show_concerts',
  'allow_account_checkin',
  'allow_guest_checkin',
  'allow_account_signup',
  'allow_guest_signup',
  'require_signup_group',
  'notify_registration_received',
  'notify_checkin_confirmation',
] as const;

// A problem in one section of the page (the app links to it).
const problem = (section: string, message: string, index?: number) =>
  new ApiError(message, 400, `onboarding_${section}${index != null ? `_${index}` : ''}`);

const photoUrl = (value: unknown) => {
  const url = text(value);
  return url && PHOTO.test(url) && !url.includes('..') ? url : null;
};

const onboarding_create = (args: Args) => {
  const uid = authUid();
  if (!uid) throw new ApiError('Authentication required', 401, '42501');
  if (!(db.prepare(`select (${canManageProjects()}) as v`).get() as { v: number }).v) throw forbidden('Access denied');
  const draft = isObj(args.p_draft) ? args.p_draft : {};
  const project = isObj(draft.project) ? draft.project : {};
  const settings = isObj(draft.settings) ? draft.settings : {};

  // 1 · the project and its settings
  const name = trimmed(project.name, 200);
  if (!name) throw problem('project', 'The project needs a name');
  const groupsSection = isObj(draft.groups) ? draft.groups : {};
  const groups = list(groupsSection.items, 100)
    .map((g) => ({ name: trimmed(g.name, 120), color: HEX.test(text(g.color)) ? text(g.color) : '#64748b', raw: g }))
    .filter((g) => g.name);
  const groupNames = new Map<string, string>();
  for (const g of groups) {
    if (groupNames.has(g.name.toLowerCase())) throw problem('groups', `“${g.name}” appears twice`);
    groupNames.set(g.name.toLowerCase(), g.name);
  }
  const defaultGroup = groupNames.get(trimmed(settings.default_group, 120).toLowerCase()) ?? null;
  const values: Row = {
    name,
    description: trimmed(project.description, 2000) || null,
    image_url: photoUrl(project.image_url),
    created_by: uid,
    default_group: defaultGroup,
  };
  for (const key of SETTINGS) if (typeof settings[key] === 'boolean') values[key] = settings[key] ? 1 : 0;
  const columns = Object.keys(values);
  const { id: projectId } = db
    .prepare(`insert into projects (${columns.join(', ')}) values (${columns.map((c) => `@${c}`).join(', ')}) returning id`)
    .get(values) as { id: string };

  // 3 · groups, who looks after them, their notes
  groups.forEach((g, position) => {
    const { id: groupId } = db
      .prepare('insert into project_groups (project_id, name, color, position) values (?, ?, ?, ?) returning id')
      .get(projectId, g.name, g.color, position) as { id: string };
    list(g.raw.responsibles, 30).forEach((person, index) => {
      const userId = text(person.id);
      if (!db.prepare('select 1 from app_users where id = ?').get(userId)) throw problem('groups', 'Unknown account');
      db.prepare('insert or ignore into group_responsibles (group_id, user_id, position) values (?, ?, ?)').run(groupId, userId, index);
    });
    const note = trimmed(g.raw.note, 4000);
    if (note) db.prepare('insert into group_notes (group_id, note) values (?, ?)').run(groupId, note);
  });

  // 4 · Proben: empty rows don't count; a started one needs a title.
  let events = 0;
  list(draft.events, 500).forEach((e, index) => {
    const row = {
      name: trimmed(e.name, 200),
      description: trimmed(e.description, 500) || null,
      date: text(e.date),
      time: text(e.time),
      end_time: text(e.end_time),
      location: trimmed(e.location, 200) || null,
    };
    const started = row.name || row.description || row.date || row.time || row.end_time || row.location;
    if (!started) return;
    if (!row.name) throw problem('events', 'A Probe needs a title', index);
    if ((row.date && !DATE.test(row.date)) || (row.time && !TIME.test(row.time)) || (row.end_time && !TIME.test(row.end_time))) {
      throw problem('events', 'Invalid date or time', index);
    }
    db.prepare(
      'insert into events (project_id, name, description, date, time, end_time, location) values (?, ?, ?, ?, ?, ?, ?)',
    ).run(projectId, row.name, row.description, row.date || null, row.time || null, row.time && row.end_time ? row.end_time : null, row.location);
    events++;
  });

  // 5 · members: groups must be the project's (never created by the way);
  // a confirmed account with the same email is linked right away.
  let members = 0;
  for (const [index, m] of list(draft.members, 5000).entries()) {
    const first = trimmed(m.first_name, 120);
    const last = trimmed(m.last_name, 120);
    if (!first && !last) continue;
    const rawGroup = trimmed(m.group_name, 120);
    const group = rawGroup ? groupNames.get(rawGroup.toLowerCase()) : null;
    if (rawGroup && !group) throw problem('members', `Unknown group “${rawGroup}”`, index);
    const email = trimmed(m.email, 254).toLowerCase() || null;
    if (email && !EMAIL.test(email)) throw problem('members', `Invalid email ${email}`, index);
    const account = email
      ? (db
          .prepare(
            `select a.id from auth_users a join app_users u on u.id = a.id
             where a.email = ? and a.email_confirmed_at is not null and u.role <> 'music_director'
               and not exists (select 1 from members x where x.project_id = ? and x.user_id = a.id)`,
          )
          .get(email, projectId) as { id: string } | undefined)
      : undefined;
    db.prepare(
      `insert into members (project_id, first_name, last_name, email, group_name, status, user_id)
       values (?, ?, ?, ?, ?, 'active', ?)`,
    ).run(projectId, first, last, email, group ?? null, account?.id ?? null);
    members++;
  }

  // 6 · a first registration form (inactive unless chosen)
  let registration = 0;
  const reg = isObj(draft.registration) ? draft.registration : null;
  if (reg) {
    const title = trimmed(reg.title, 200);
    if (!title) throw problem('registration', 'The form needs a title');
    const closesAt = text(reg.closes_at);
    if (closesAt && (!ISO.test(closesAt) || Number.isNaN(Date.parse(closesAt)))) throw problem('registration', 'Invalid deadline');
    const headerMode = ['app', 'custom', 'none'].includes(text(reg.header_mode)) ? text(reg.header_mode) : 'app';
    db.prepare(
      `insert into registration_pages
         (project_id, title, description, ask_email, ask_group, is_active, auto_transfer, closes_at, cover_url,
          header_mode, header_text, tint_color, note_label, source)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'form')`,
    ).run(
      projectId,
      title,
      trimmed(reg.description, 20_000),
      reg.ask_email === false ? 0 : 1,
      reg.ask_group === false ? 0 : 1,
      reg.active === true ? 1 : 0,
      reg.auto_transfer === true ? 1 : 0,
      closesAt || null,
      photoUrl(reg.cover_url),
      headerMode,
      trimmed(reg.header_text, 80) || null,
      HEX.test(text(reg.tint_color)) ? text(reg.tint_color) : null,
      reg.note_label == null ? null : trimmed(reg.note_label, 80) || null,
    );
    registration = 1;
  }

  // 7 · concerts (unpublished)
  let concerts = 0;
  list(draft.concerts, 200).forEach((c, index) => {
    const row = {
      title: trimmed(c.title, 200),
      date: text(c.date),
      time: text(c.time),
      location: trimmed(c.location, 300),
      description: trimmed(c.description, 2000),
    };
    if (!(row.title || row.date || row.time || row.location || row.description)) return;
    if (!row.title) throw problem('concerts', 'A concert needs a title', index);
    if ((row.date && !DATE.test(row.date)) || (row.time && !TIME.test(row.time))) throw problem('concerts', 'Invalid date or time', index);
    db.prepare('insert into concerts (project_id, title, date, time, location, description) values (?, ?, ?, ?, ?, ?)').run(
      projectId,
      row.title,
      row.date || null,
      row.time || null,
      row.location,
      row.description,
    );
    concerts++;
  });

  // 8 · pieces: from the collection (once each) or new ones, which join the
  // collection as well.
  const creator = (db.prepare('select name from app_users where id = ?').get(uid) as { name: string } | undefined)?.name ?? '';
  const seen = new Set<string>();
  let pieces = 0;
  list(draft.pieces, 500).forEach((p, index) => {
    let pieceId = text(p.piece_id);
    if (pieceId) {
      if (seen.has(pieceId)) return;
      if (!db.prepare('select 1 from pieces where id = ? and not archived').get(pieceId)) throw problem('pieces', 'Unknown piece', index);
    } else {
      const title = trimmed(p.name, 200);
      if (!title) {
        if (trimmed(p.composer, 200)) throw problem('pieces', 'A piece needs a title', index);
        return;
      }
      pieceId = (
        db.prepare('insert into pieces (name, composer, description) values (?, ?, ?) returning id').get(title, trimmed(p.composer, 200), '') as {
          id: string;
        }
      ).id;
      db.prepare('insert into piece_credits (piece_id, name, user_id) values (?, ?, ?)').run(pieceId, creator, uid);
    }
    seen.add(pieceId);
    db.prepare('insert into project_pieces (project_id, piece_id, position) values (?, ?, ?)').run(projectId, pieceId, pieces);
    pieces++;
  });

  // 9 · the audition rule (only with conditions)
  let audition = 0;
  const rule = isObj(draft.audition) ? draft.audition : {};
  const conditions = list(rule.conditions, 20).filter(
    (c) =>
      ['and', 'or'].includes(text(c.connector)) &&
      ['attended', 'excused', 'absent', 'missed'].includes(text(c.metric)) &&
      ['gte', 'gt', 'eq', 'lt', 'lte'].includes(text(c.comparison)) &&
      Number.isInteger(c.value),
  );
  if (conditions.length) {
    db.prepare(
      `insert into absence_labels (project_id, name, conditions, is_public, kind, position) values (?, ?, ?, 1, 'audition', 0)`,
    ).run(projectId, trimmed(rule.name, 120) || 'Vorsingen', JSON.stringify(conditions));
    audition = 1;
  }

  db.prepare('delete from onboarding_drafts where user_id = ?').run(uid);
  const summary = { groups: groups.length, events, members, registration, concerts, pieces, audition };
  auditNote({ action: 'project.onboarding', details: summary });
  return { project_id: projectId, summary, created_at: nowIso() };
};

export const onboardingFunctions = { onboarding_create };
