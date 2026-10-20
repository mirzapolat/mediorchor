// Rehearsal weekends beyond plain table access: the list as each person may
// see it, importing participants (preview, then apply, and undoing the last
// import), adding and resolving entries by hand, the rooms as confirmed
// participants see them, choosing a room (atomic: the target's capacity is
// checked, the new place taken and the old one freed — all or nothing), and
// a person's contacts as far as they share them with this very person.
import { db, authUid, ApiError, forbidden, nowIso } from './db.ts';
import { canAccessProject, isProjectParticipant, weekendInManagedProject } from './policies.ts';
import { splitName } from './fieldMatching.ts';
import { auditNote } from './audit.ts';
import { registrationToMember } from './rpc.ts';

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

interface WeekendRow {
  id: string;
  project_id: string;
  title: string;
  starts_on: string | null;
  ends_on: string | null;
  location: string;
  description: string;
  signup_url: string | null;
  status: 'draft' | 'published' | 'closed';
  archived: number;
  created_at: string;
}

interface ParticipantRow {
  id: string;
  weekend_id: string;
  kind: 'member' | 'guest' | 'pending';
  member_id: string | null;
  user_id: string | null;
  name: string;
  email: string | null;
  group_name: string | null;
  source_name: string | null;
  source_email: string | null;
  import_id: string | null;
  changed_by_hand: number;
}

const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const holds = (sql: string, params: Record<string, unknown> = {}) =>
  Boolean((db.prepare(`select (${sql}) as v`).get(params) as { v: number }).v);

const requireUser = () => {
  const uid = authUid();
  if (!uid) throw new ApiError('Authentication required', 401, '42501');
  return uid;
};

const getWeekend = (id: string) => db.prepare('select * from weekends where id = ?').get(id) as WeekendRow | undefined;

const isManager = (weekendId: string) => holds(weekendInManagedProject('@wid'), { wid: weekendId });

const requireManagedWeekend = (weekendId: string) => {
  requireUser();
  const weekend = getWeekend(weekendId);
  if (!weekend || !isManager(weekend.id)) throw forbidden('Access denied');
  return weekend;
};

const shown = (w: WeekendRow) => (w.status === 'published' || w.status === 'closed') && !w.archived;

// The caller's confirmed entry in a weekend, if any.
const myEntry = (weekendId: string, uid: string) =>
  db
    .prepare(
      `select wp.* from weekend_participants wp left join members m on m.id = wp.member_id
       where wp.weekend_id = ? and wp.kind in ('member', 'guest') and (wp.user_id = ? or m.user_id = ?)
       limit 1`,
    )
    .get(weekendId, uid, uid) as ParticipantRow | undefined;

// Lower case, without accents and punctuation, ß as ss: "Müller-Lüdenscheidt,
// Jörg" and "jorg muller ludenscheidt" compare equal (as words, any order).
// `umlauts` spells ä/ö/ü as ae/oe/ue instead, so "Joerg" finds "Jörg" too.
export const normalizeName = (value: unknown, umlauts = false) =>
  (umlauts ? text(value).replace(/ä/gi, 'ae').replace(/ö/gi, 'oe').replace(/ü/gi, 'ue') : text(value))
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ');

// Two names are the same when either spelling agrees.
const sameName = (a: unknown, b: unknown) => {
  const plain = normalizeName(a);
  if (!plain) return false;
  return plain === normalizeName(b) || normalizeName(a, true) === normalizeName(b, true);
};

const normalizeEmail = (value: unknown) => text(value).trim().toLowerCase();

// ---------------------------------------------------------------------------
// What each person sees
// ---------------------------------------------------------------------------

// The project's weekends for the caller: managers all of them; others the
// published ones — with their own place (confirmed, room) in each.
const weekend_list = (args: Args) => {
  const uid = requireUser();
  const projectId = text(args.p_project_id);
  const manager = holds(canAccessProject('@pid'), { pid: projectId });
  const member = holds(isProjectParticipant('@pid'), { pid: projectId });
  const rows = db
    .prepare('select * from weekends where project_id = ? order by coalesce(starts_on, created_at)')
    .all(projectId) as WeekendRow[];
  return rows
    .filter((w) => manager || (shown(w) && (member || myEntry(w.id, uid))))
    .map((w) => {
      const mine = myEntry(w.id, uid);
      const room = mine
        ? (db.prepare('select room_id from weekend_room_assignments where participant_id = ?').get(mine.id) as
            | { room_id: string }
            | undefined)
        : undefined;
      const counts = manager
        ? (db
            .prepare(
              `select count(*) as participants,
                      sum(kind in ('member', 'guest')) as confirmed,
                      (select count(*) from weekend_rooms r where r.weekend_id = @id) as rooms
               from weekend_participants where weekend_id = @id`,
            )
            .get({ id: w.id }) as Row)
        : null;
      return {
        ...w,
        archived: Boolean(w.archived),
        me: { confirmed: Boolean(mine), room_id: room?.room_id ?? null },
        counts,
      };
    });
};

const photoOf = (p: { member_id: string | null; user_id: string | null }) => {
  if (p.member_id) {
    const m = db.prepare('select photo_url, user_id from members where id = ?').get(p.member_id) as
      | { photo_url: string | null; user_id: string | null }
      | undefined;
    if (m?.photo_url) return m.photo_url;
  }
  if (p.user_id) {
    return (db.prepare('select photo_url from app_users where id = ?').get(p.user_id) as { photo_url: string | null } | undefined)
      ?.photo_url ?? null;
  }
  return null;
};

// May the caller see this weekend's rooms: its managers, and its confirmed
// participants while it is published (or closed).
const roomAccess = (weekendId: string) => {
  const uid = requireUser();
  const weekend = getWeekend(weekendId);
  if (!weekend) throw new ApiError('Not found', 404);
  const manager = isManager(weekend.id);
  const mine = myEntry(weekend.id, uid);
  if (!manager && !(shown(weekend) && mine)) throw forbidden('Only confirmed participants see the rooms');
  return { uid, weekend, manager, mine };
};

const weekend_rooms_view = (args: Args) => {
  const { weekend, manager, mine } = roomAccess(text(args.p_weekend_id));
  const rooms = db
    .prepare('select * from weekend_rooms where weekend_id = ? order by position, created_at')
    .all(weekend.id) as Row[];
  const placed = db
    .prepare(
      `select a.room_id, wp.* from weekend_room_assignments a
       join weekend_participants wp on wp.id = a.participant_id
       where wp.weekend_id = ? order by wp.name collate nocase`,
    )
    .all(weekend.id) as Array<ParticipantRow & { room_id: string }>;
  const person = (p: ParticipantRow) => ({
    participant_id: p.id,
    name: p.name,
    group_name: p.group_name,
    photo_url: photoOf(p),
    kind: p.kind,
    mine: mine?.id === p.id,
  });
  const myRoom = mine ? placed.find((p) => p.id === mine.id)?.room_id ?? null : null;
  return {
    weekend: { id: weekend.id, title: weekend.title, status: weekend.status, archived: Boolean(weekend.archived) },
    manager,
    me: mine ? { participant_id: mine.id, room_id: myRoom } : null,
    // Choosing oneself: while the weekend is published.
    can_choose: Boolean(mine) && weekend.status === 'published' && !weekend.archived,
    rooms: rooms.map((r) => ({
      ...r,
      occupants: placed.filter((p) => p.room_id === r.id).map(person),
    })),
    // Confirmed people without a room (for placing them), managers only.
    unassigned: manager
      ? (
          db
            .prepare(
              `select * from weekend_participants wp where wp.weekend_id = ? and wp.kind in ('member', 'guest')
                 and not exists (select 1 from weekend_room_assignments a where a.participant_id = wp.id)
               order by wp.name collate nocase`,
            )
            .all(weekend.id) as ParticipantRow[]
        ).map(person)
      : [],
  };
};

// Takes `participantId`'s place in `roomId` (null: frees it) — in one
// transaction (callFunction): the target's capacity is checked against
// everyone else in it, then the place is set, which frees the old one. A
// full target leaves the old place as it was.
const placeIn = (participantId: string, roomId: string | null, weekendId: string, by: string) => {
  if (!roomId) {
    db.prepare('delete from weekend_room_assignments where participant_id = ?').run(participantId);
    return { state: 'ok' as const };
  }
  const room = db.prepare('select id, capacity from weekend_rooms where id = ? and weekend_id = ?').get(roomId, weekendId) as
    | { id: string; capacity: number }
    | undefined;
  if (!room) throw new ApiError('Unknown room', 400);
  const { n } = db
    .prepare('select count(*) as n from weekend_room_assignments where room_id = ? and participant_id <> ?')
    .get(room.id, participantId) as { n: number };
  if (n >= room.capacity) return { state: 'full' as const };
  db.prepare(
    `insert into weekend_room_assignments (participant_id, room_id, assigned_by, assigned_at) values (?, ?, ?, ?)
     on conflict (participant_id) do update set room_id = excluded.room_id, assigned_by = excluded.assigned_by,
       assigned_at = excluded.assigned_at`,
  ).run(participantId, room.id, by, nowIso());
  return { state: 'ok' as const };
};

// A confirmed participant takes a free place, switches or frees theirs.
const weekend_choose_room = (args: Args) => {
  const { uid, weekend, mine } = roomAccess(text(args.p_weekend_id));
  if (!mine || weekend.status !== 'published' || weekend.archived) throw forbidden('Rooms can’t be chosen now');
  return placeIn(mine.id, text(args.p_room_id) || null, weekend.id, uid);
};

// Managers place and move anyone confirmed (also guests without an account).
const weekend_place = (args: Args) => {
  const uid = requireUser();
  const p = db.prepare('select * from weekend_participants where id = ?').get(text(args.p_participant_id)) as
    | ParticipantRow
    | undefined;
  if (!p || !isManager(p.weekend_id)) throw forbidden('Access denied');
  if (p.kind === 'pending') throw new ApiError('Confirm the entry first', 400, 'not_confirmed');
  return placeIn(p.id, text(args.p_room_id) || null, p.weekend_id, uid);
};

// The account behind an entry (directly or through its member row).
const accountOf = (p: ParticipantRow) => {
  if (p.user_id) return p.user_id;
  if (!p.member_id) return null;
  return (db.prepare('select user_id from members where id = ?').get(p.member_id) as { user_id: string | null } | undefined)
    ?.user_id ?? null;
};

// One person of the weekend: photo, name, group and exactly the contacts
// they share with the caller — the weekend's confirmed participants
// ('weekend'), or only those sharing their room ('room'). Managers see all
// (as everywhere else); one's own entry shows one's own with its setting.
const weekend_person = (args: Args) => {
  const { uid, weekend, manager, mine } = roomAccess(text(args.p_weekend_id));
  const target = db
    .prepare(`select * from weekend_participants where id = ? and weekend_id = ? and kind in ('member', 'guest')`)
    .get(text(args.p_participant_id), weekend.id) as ParticipantRow | undefined;
  if (!target) throw new ApiError('Not found', 404);
  const account = accountOf(target);
  const roomOf = (id: string) =>
    (db.prepare('select room_id from weekend_room_assignments where participant_id = ?').get(id) as { room_id: string } | undefined)
      ?.room_id ?? null;
  let contacts: Row[] = [];
  if (account) {
    const all = db
      .prepare('select id, kind, label, value, position, room_share from account_contacts where user_id = ? order by position, created_at')
      .all(account) as Row[];
    const self = account === uid;
    const sameRoom = mine != null && roomOf(mine.id) != null && roomOf(mine.id) === roomOf(target.id);
    contacts =
      manager || self
        ? all
        : all.filter((c) => c.room_share === 'weekend' || (c.room_share === 'room' && sameRoom));
  }
  return {
    name: target.name,
    group_name: target.group_name,
    photo_url: photoOf(target),
    kind: target.kind,
    has_account: Boolean(account),
    self: account === uid,
    contacts,
  };
};

// ---------------------------------------------------------------------------
// The participant list: import, by hand, undo
// ---------------------------------------------------------------------------

interface Candidate {
  member_id: string | null;
  user_id: string | null;
  name: string;
  email: string | null;
  group_name: string | null;
  status: 'active' | 'archived' | 'account';
}

interface Entry {
  name: string;
  email: string;
  group: string;
}

const entriesOf = (value: unknown): Entry[] =>
  (Array.isArray(value) ? value.slice(0, 2000) : [])
    .filter(isObj)
    .map((e) => ({
      name: text(e.name).trim().slice(0, 200),
      email: normalizeEmail(e.email).slice(0, 254),
      group: text(e.group).trim().slice(0, 120),
    }))
    .filter((e) => e.name || e.email);

// Who an imported line is: already on the list ("existing"), recognised for
// sure (linked account or unique email; else a unique name, its group not
// contradicting), to be confirmed (several or partial matches — never taken
// over by themselves) or not recognised.
const matchEntry = (projectId: string, weekendId: string, entry: Entry) => {
  const members = db
    .prepare(
      `select m.id as member_id, m.user_id, trim(m.first_name || ' ' || m.last_name) as name, m.email, m.group_name, m.status
       from members m where m.project_id = ? and m.status in ('active', 'archived')`,
    )
    .all(projectId) as Array<Candidate & { status: 'active' | 'archived' }>;
  const participants = db.prepare('select * from weekend_participants where weekend_id = ?').all(weekendId) as ParticipantRow[];
  const email = entry.email;
  const name = normalizeName(entry.name);
  const group = entry.group.toLowerCase();

  const existing = listedAs(participants, entry);
  if (existing) return { status: 'existing' as const, existing_id: existing.id, match: null, candidates: [] as Candidate[] };

  if (email) {
    const byEmail = members.filter((m) => normalizeEmail(m.email) === email);
    if (byEmail.length === 1) return { status: 'sure' as const, match: byEmail[0], candidates: byEmail };
    if (byEmail.length === 0) {
      const account = db
        .prepare(`select id as user_id, name, email from app_users where email = ?`)
        .get(email) as { user_id: string; name: string; email: string } | undefined;
      if (account) {
        const linked = members.find((m) => m.user_id === account.user_id);
        const candidate: Candidate = linked ?? { member_id: null, user_id: account.user_id, name: account.name, email: account.email, group_name: null, status: 'account' };
        return { status: 'sure' as const, match: candidate, candidates: [candidate] };
      }
    }
  }
  if (name) {
    const byName = members.filter((m) => sameName(m.name, entry.name));
    const active = byName.filter((m) => m.status === 'active');
    const pool = active.length ? active : byName;
    const inGroup = group ? pool.filter((m) => (m.group_name ?? '').toLowerCase() === group) : pool;
    if (pool.length === 1 && (!group || inGroup.length === 1) && pool[0].status === 'active') {
      return { status: 'sure' as const, match: pool[0], candidates: pool };
    }
    if (inGroup.length === 1 && pool.length > 1) return { status: 'confirm' as const, match: inGroup[0], candidates: pool };
    if (pool.length) return { status: 'confirm' as const, match: null, candidates: pool };
    // Partial: every word of the line in the member's name (e.g. only the
    // last name, or a middle name missing).
    const words = [name.split(' '), normalizeName(entry.name, true).split(' ')];
    const partial = members.filter((m) => {
      const own = [normalizeName(m.name).split(' '), normalizeName(m.name, true).split(' ')];
      return words.some((list, i) => list.length > 0 && list.every((w) => own[i].includes(w)));
    });
    if (partial.length) return { status: 'confirm' as const, match: null, candidates: partial.slice(0, 8) };
  }
  return { status: 'unknown' as const, match: null, candidates: [] as Candidate[] };
};

// The entry already on the list for an imported line (same email, or the
// same name as listed or as once imported).
const listedAs = (participants: ParticipantRow[], entry: Entry) =>
  participants.find(
    (p) =>
      (entry.email && (normalizeEmail(p.email) === entry.email || normalizeEmail(p.source_email) === entry.email)) ||
      (entry.name && (sameName(p.name, entry.name) || sameName(p.source_name, entry.name))),
  );

const weekend_import_preview = (args: Args) => {
  const weekend = requireManagedWeekend(text(args.p_weekend_id));
  return entriesOf(args.p_entries).map((entry, index) => ({ index, entry, ...matchEntry(weekend.project_id, weekend.id, entry) }));
};

// The name and group of a member or account to put on the list.
const personFor = (projectId: string, memberId: string | null, userId: string | null) => {
  if (memberId) {
    const m = db
      .prepare(
        `select id, user_id, trim(first_name || ' ' || last_name) as name, email, group_name from members
         where id = ? and project_id = ?`,
      )
      .get(memberId, projectId) as { id: string; user_id: string | null; name: string; email: string | null; group_name: string | null } | undefined;
    if (!m) throw new ApiError('The member is not part of this project', 400, '23503');
    return { member_id: m.id, user_id: m.user_id, name: m.name, email: m.email, group_name: m.group_name };
  }
  if (userId) {
    const u = db.prepare('select id, name, email from app_users where id = ?').get(userId) as
      | { id: string; name: string; email: string }
      | undefined;
    if (!u) throw new ApiError('Unknown account', 400, '23503');
    const linked = db.prepare('select id, group_name from members where project_id = ? and user_id = ?').get(projectId, u.id) as
      | { id: string; group_name: string | null }
      | undefined;
    return { member_id: linked?.id ?? null, user_id: u.id, name: u.name || u.email, email: u.email, group_name: linked?.group_name ?? null };
  }
  throw new ApiError('Nobody chosen', 400);
};

const findListed = (weekendId: string, memberId: string | null, userId: string | null) =>
  db
    .prepare(
      `select id from weekend_participants where weekend_id = @w
         and ((@m is not null and member_id = @m) or (@u is not null and user_id = @u))`,
    )
    .get({ w: weekendId, m: memberId, u: userId }) as { id: string } | undefined;

const insertParticipant = (row: {
  weekend_id: string;
  kind: 'member' | 'guest' | 'pending';
  member_id?: string | null;
  user_id?: string | null;
  name: string;
  email?: string | null;
  group_name?: string | null;
  source_name?: string | null;
  source_email?: string | null;
  import_id?: string | null;
  changed_by_hand?: boolean;
}) =>
  (
    db
      .prepare(
        `insert into weekend_participants
           (weekend_id, kind, member_id, user_id, name, email, group_name, source_name, source_email, import_id, changed_by_hand)
         values (@weekend_id, @kind, @member_id, @user_id, @name, @email, @group_name, @source_name, @source_email, @import_id, @changed_by_hand)
         returning id`,
      )
      .get({
        member_id: null,
        user_id: null,
        email: null,
        group_name: null,
        source_name: null,
        source_email: null,
        import_id: null,
        ...row,
        changed_by_hand: row.changed_by_hand ? 1 : 0,
      }) as { id: string }
  ).id;

// An existing group of the project in its own spelling, or null (an import
// never creates groups by the way).
const knownGroup = (projectId: string, group: string) =>
  group
    ? ((db.prepare('select name from project_groups where project_id = ? and name = ? collate nocase').get(projectId, group) as
        | { name: string }
        | undefined)?.name ?? null)
    : null;

// Applies a previewed import: each line linked to a member or account,
// added as a weekend guest, taken over as a new project member, or
// skipped. Lines whose person is listed already are recognised, not doubled.
const weekend_import_apply = (args: Args) => {
  const uid = requireUser();
  const weekend = requireManagedWeekend(text(args.p_weekend_id));
  const rows = (Array.isArray(args.p_rows) ? args.p_rows : []).filter(isObj).slice(0, 2000);
  const stats = { new: 0, recognized: 0, manual: 0, skipped: 0, new_members: 0 };
  const userName = (db.prepare('select name from app_users where id = ?').get(uid) as { name: string } | undefined)?.name ?? '';
  const { id: importId } = db
    .prepare(
      `insert into weekend_imports (weekend_id, source, file_name, created_by, created_by_name)
       values (?, ?, ?, ?, ?) returning id`,
    )
    .get(weekend.id, args.p_source === 'csv' ? 'csv' : 'paste', text(args.p_file_name).slice(0, 200) || null, uid, userName) as {
    id: string;
  };
  for (const row of rows) {
    const [entry] = entriesOf([row.entry]);
    const action = text(row.action);
    if (!entry || action === 'skip') {
      stats.skipped++;
      continue;
    }
    if (row.manual === true) stats.manual++;
    const source = { source_name: entry.name || null, source_email: entry.email || null, import_id: importId };
    if (action === 'link' || action === 'new_member') {
      let memberId = text(row.member_id) || null;
      const userId = text(row.user_id) || null;
      if (action === 'new_member') {
        const { first, last } = splitName(entry.name || entry.email.split('@')[0]);
        memberId = registrationToMember(weekend.project_id, first, last, knownGroup(weekend.project_id, entry.group), entry.email || null, null);
        stats.new_members++;
      }
      const person = personFor(weekend.project_id, memberId, memberId ? null : userId);
      if (findListed(weekend.id, person.member_id, person.user_id)) {
        stats.recognized++;
        continue;
      }
      insertParticipant({ weekend_id: weekend.id, kind: 'member', ...person, ...source });
      stats.new++;
    } else if (
      listedAs(db.prepare('select * from weekend_participants where weekend_id = ?').all(weekend.id) as ParticipantRow[], entry)
    ) {
      // Guests and open lines already on the list: recognised, not doubled.
      stats.recognized++;
    } else if (action === 'guest') {
      insertParticipant({
        weekend_id: weekend.id,
        kind: 'guest',
        name: entry.name || entry.email,
        email: entry.email || null,
        group_name: entry.group || null,
        ...source,
      });
      stats.new++;
    } else if (action === 'existing') {
      stats.recognized++;
    } else {
      // Not decided yet: kept as an unresolved entry.
      insertParticipant({
        weekend_id: weekend.id,
        kind: 'pending',
        name: entry.name || entry.email,
        email: entry.email || null,
        group_name: entry.group || null,
        ...source,
      });
      stats.new++;
    }
  }
  db.prepare('update weekend_imports set stats = ? where id = ?').run(JSON.stringify(stats), importId);
  auditNote({ action: 'weekend.import', details: stats });
  return { import_id: importId, stats };
};

// Undoes the last import: removes only the entries it made that nobody
// changed by hand since and that have no room. The others are listed for a
// look — never removed silently. (Members it created stay members.)
const weekend_import_undo = (args: Args) => {
  const weekend = requireManagedWeekend(text(args.p_weekend_id));
  const last = db
    .prepare('select id from weekend_imports where weekend_id = ? and undone_at is null order by created_at desc, rowid desc limit 1')
    .get(weekend.id) as { id: string } | undefined;
  if (!last) return { removed: 0, kept: [] };
  const entries = db
    .prepare(
      `select wp.id, wp.name, wp.changed_by_hand,
              exists (select 1 from weekend_room_assignments a where a.participant_id = wp.id) as placed
       from weekend_participants wp where wp.import_id = ?`,
    )
    .all(last.id) as { id: string; name: string; changed_by_hand: number; placed: number }[];
  const kept: { id: string; name: string; reason: 'changed' | 'room' }[] = [];
  let removed = 0;
  for (const e of entries) {
    if (e.changed_by_hand || e.placed) {
      kept.push({ id: e.id, name: e.name, reason: e.placed ? 'room' : 'changed' });
      continue;
    }
    db.prepare('delete from weekend_participants where id = ?').run(e.id);
    removed++;
  }
  db.prepare('update weekend_imports set undone_at = ? where id = ?').run(nowIso(), last.id);
  return { removed, kept };
};

// Adds someone by hand: a member, an account, or a guest by name.
const weekend_add_participant = (args: Args) => {
  const weekend = requireManagedWeekend(text(args.p_weekend_id));
  const memberId = text(args.p_member_id) || null;
  const userId = text(args.p_user_id) || null;
  if (memberId || userId) {
    const person = personFor(weekend.project_id, memberId, memberId ? null : userId);
    const listed = findListed(weekend.id, person.member_id, person.user_id);
    if (listed) return { id: listed.id, existed: true };
    return { id: insertParticipant({ weekend_id: weekend.id, kind: 'member', ...person, changed_by_hand: true }), existed: false };
  }
  const name = text(args.p_name).trim().slice(0, 200);
  if (!name) throw new ApiError('A guest needs a name', 400, '23514');
  const email = normalizeEmail(args.p_email).slice(0, 254) || null;
  return { id: insertParticipant({ weekend_id: weekend.id, kind: 'guest', name, email, changed_by_hand: true }), existed: false };
};

// Resolves an entry: link it to a member or account, keep it as a guest
// (only for the weekend), or take the person over as a new project member.
const weekend_resolve_participant = (args: Args) => {
  const p = db.prepare('select * from weekend_participants where id = ?').get(text(args.p_participant_id)) as
    | ParticipantRow
    | undefined;
  if (!p) throw new ApiError('Not found', 404);
  const weekend = requireManagedWeekend(p.weekend_id);
  const action = text(args.p_action);
  if (action === 'guest') {
    db.prepare(`update weekend_participants set kind = 'guest', member_id = null, user_id = null, changed_by_hand = 1, updated_at = ? where id = ?`).run(
      nowIso(),
      p.id,
    );
    return { ok: true };
  }
  let memberId = text(args.p_member_id) || null;
  if (action === 'new_member') {
    const { first, last } = splitName(p.source_name || p.name);
    memberId = registrationToMember(weekend.project_id, first, last, knownGroup(weekend.project_id, p.group_name ?? ''), p.email, null);
  } else if (action !== 'link') {
    throw new ApiError('Unknown action', 400);
  }
  const person = personFor(weekend.project_id, memberId, memberId ? null : text(args.p_user_id) || null);
  const listed = findListed(weekend.id, person.member_id, person.user_id);
  if (listed && listed.id !== p.id) throw new ApiError('This person is on the list already', 409, 'already_listed');
  db.prepare(
    `update weekend_participants set kind = 'member', member_id = @member_id, user_id = @user_id, name = @name,
       email = @email, group_name = @group_name, changed_by_hand = 1, updated_at = @now where id = @id`,
  ).run({ ...person, now: nowIso(), id: p.id });
  return { ok: true };
};

// ---------------------------------------------------------------------------
// Navigation and personal to-dos
// ---------------------------------------------------------------------------

// For the project navigation: whether the weekend area shows, and whether
// the caller still has to pick a room in a published weekend with rooms.
export const weekendNav = (projectId: string, uid: string, manager: boolean, participant: boolean) => {
  const weekends = db
    .prepare(`select * from weekends where project_id = ? and status in ('published', 'closed') and not archived`)
    .all(projectId) as WeekendRow[];
  const confirmed = weekends.filter((w) => myEntry(w.id, uid));
  return {
    weekend: manager || (weekends.length > 0 && (participant || confirmed.length > 0)),
    room_missing: confirmed.filter((w) => w.status === 'published' && roomMissing(w.id, uid)).length,
  };
};

const roomMissing = (weekendId: string, uid: string) => {
  const mine = myEntry(weekendId, uid);
  if (!mine) return false;
  const hasRooms = db.prepare('select 1 from weekend_rooms where weekend_id = ? limit 1').get(weekendId);
  const placed = db.prepare('select 1 from weekend_room_assignments where participant_id = ?').get(mine.id);
  return Boolean(hasRooms) && !placed;
};

// Published weekends (across projects) where the account is confirmed but
// has no room yet — for the dashboard.
export const missingRoomsFor = (uid: string) =>
  (
    db
      .prepare(
        `select w.id, w.title, w.starts_on, w.project_id, p.name as project_name, p.image_url as project_image
         from weekends w join projects p on p.id = w.project_id
         where w.status = 'published' and not w.archived and p.status = 'active'`,
      )
      .all() as Array<{ id: string; title: string; starts_on: string | null; project_id: string; project_name: string; project_image: string | null }>
  )
    .filter((w) => roomMissing(w.id, uid))
    .map((w) => ({
      weekend_id: w.id,
      title: w.title,
      starts_on: w.starts_on,
      project: { id: w.project_id, name: w.project_name, image_url: w.project_image },
    }));

export const weekendFunctions = {
  weekend_list,
  weekend_rooms_view,
  weekend_choose_room,
  weekend_place,
  weekend_person,
  weekend_import_preview,
  weekend_import_apply,
  weekend_import_undo,
  weekend_add_participant,
  weekend_resolve_participant,
};

export const WEEKEND_READ_FUNCTIONS = ['weekend_list', 'weekend_rooms_view', 'weekend_person', 'weekend_import_preview'];
