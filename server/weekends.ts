// Rehearsal weekends beyond plain table access: the list as each person may
// see it, importing participants (preview, then apply, and undoing the last
// import), adding and resolving entries by hand, the rooms as confirmed
// participants see them, choosing a room (atomic: the target's capacity is
// checked night by night, the new place taken and the old one freed — all
// or nothing), and a person's contacts as far as they share them with this
// very person. The room choice can also be shared as a link: whoever opens
// it continues with their account or as a guest (name and nights; a key in
// their browser brings them back to their place).
import { createHash, randomBytes } from 'node:crypto';
import { db, authUid, ApiError, forbidden, nowIso } from './db.ts';
import { canAccessProject, isProjectParticipant, weekendInManagedProject } from './policies.ts';
import { splitName } from './fieldMatching.ts';
import { auditNote } from './audit.ts';
import { registrationToMember } from './rpc.ts';
import { cleanPeriods, nightCount, peakOccupancy } from '../shared/weekendNights.ts';
import { nightsFor, roomNights } from './weekendRoomNights.ts';

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
  details_published: number;
  rooms_status: 'hidden' | 'open' | 'locked';
  days: number | null;
  periods: string;
  link_token: string | null;
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
  booking: string | null;
  night_from: number | null;
  night_to: number | null;
  guest_key_hash: string | null;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const newSecret = (bytes = 18) => randomBytes(bytes).toString('base64url');

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

// Participants see a weekend once its details or its rooms are released;
// the rooms (and choosing one) only with their own release.
const shown = (w: WeekendRow) => !w.archived && (Boolean(w.details_published) || w.rooms_status !== 'hidden');
const roomsShown = (w: WeekendRow) => !w.archived && w.rooms_status !== 'hidden';
const roomsOpen = (w: WeekendRow) => !w.archived && w.rooms_status === 'open';


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
      // Unreleased details stay the managers'.
      const details = manager || Boolean(w.details_published);
      return {
        ...w,
        description: details ? w.description : '',
        signup_url: details ? w.signup_url : null,
        details_published: Boolean(w.details_published),
        periods: cleanPeriods(JSON.parse(w.periods || '[]')),
        // The shared link is the managers'.
        link_token: manager ? w.link_token : null,
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

// Someone who joined through the link without an account, by the key in
// their browser — confirmed, or still to be resolved ('pending').
const guestByKey = (key: string) =>
  key
    ? (db.prepare('select * from weekend_participants where guest_key_hash = ?').get(sha256(key)) as ParticipantRow | undefined)
    : undefined;

// May the caller see this weekend's rooms: its managers, and its confirmed
// participants once the rooms are released — by account, or as a guest of
// the link by their key (`p_guest_key`, no account).
const roomAccess = (args: Args) => {
  const key = text(args.p_guest_key);
  if (key) {
    const entry = guestByKey(key);
    const mine = entry && entry.kind !== 'pending' ? entry : undefined;
    const weekend = mine && getWeekend(mine.weekend_id);
    if (!mine || !weekend || !roomsShown(weekend)) throw forbidden('Only confirmed participants see the rooms');
    return { uid: null, weekend, manager: false, mine };
  }
  const uid = requireUser();
  const weekend = getWeekend(text(args.p_weekend_id));
  if (!weekend) throw new ApiError('Not found', 404);
  const manager = isManager(weekend.id);
  const mine = myEntry(weekend.id, uid);
  if (!manager && !(roomsShown(weekend) && mine)) throw forbidden('Only confirmed participants see the rooms');
  return { uid, weekend, manager, mine };
};

const weekend_rooms_view = (args: Args) => {
  const { weekend, manager, mine } = roomAccess(args);
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
  const nights = nightsFor(weekend);
  const person = (p: ParticipantRow) => ({
    participant_id: p.id,
    name: p.name,
    group_name: p.group_name,
    photo_url: photoOf(p),
    kind: p.kind,
    mine: mine?.id === p.id,
    booking: p.booking,
    nights: nights(p),
  });
  const myRoom = mine ? placed.find((p) => p.id === mine.id)?.room_id ?? null : null;
  return {
    weekend: { id: weekend.id, title: weekend.title, rooms_status: weekend.rooms_status, archived: Boolean(weekend.archived) },
    manager,
    night_count: nightCount(weekend),
    me: mine ? { participant_id: mine.id, room_id: myRoom, nights: nights(mine) } : null,
    // Choosing oneself: while the rooms are open.
    can_choose: Boolean(mine) && roomsOpen(weekend),
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
// transaction (callFunction): the target's capacity is checked in each of
// the participant's nights against everyone else there that night (people
// whose nights don't overlap share a place), then the place is set, which
// frees the old one. A full target leaves the old place as it was.
const placeIn = (participantId: string, roomId: string | null, weekend: WeekendRow, by: string | null) => {
  if (!roomId) {
    db.prepare('delete from weekend_room_assignments where participant_id = ?').run(participantId);
    return { state: 'ok' as const };
  }
  const room = db.prepare('select id, capacity from weekend_rooms where id = ? and weekend_id = ?').get(roomId, weekend.id) as
    | { id: string; capacity: number }
    | undefined;
  if (!room) throw new ApiError('Unknown room', 400);
  const mine = nightsFor(weekend)(
    db.prepare('select booking, night_from, night_to from weekend_participants where id = ?').get(participantId) as ParticipantRow,
  );
  if (peakOccupancy(roomNights(room.id, participantId), mine) >= room.capacity) return { state: 'full' as const };
  db.prepare(
    `insert into weekend_room_assignments (participant_id, room_id, assigned_by, assigned_at) values (?, ?, ?, ?)
     on conflict (participant_id) do update set room_id = excluded.room_id, assigned_by = excluded.assigned_by,
       assigned_at = excluded.assigned_at`,
  ).run(participantId, room.id, by, nowIso());
  return { state: 'ok' as const };
};

// A confirmed participant takes a free place, switches or frees theirs.
const weekend_choose_room = (args: Args) => {
  const { uid, weekend, mine } = roomAccess(args);
  if (!mine || !roomsOpen(weekend)) throw forbidden('Rooms can’t be chosen now');
  return placeIn(mine.id, text(args.p_room_id) || null, weekend, uid);
};

// Managers place and move anyone confirmed (also guests without an account).
const weekend_place = (args: Args) => {
  const uid = requireUser();
  const p = db.prepare('select * from weekend_participants where id = ?').get(text(args.p_participant_id)) as
    | ParticipantRow
    | undefined;
  if (!p || !isManager(p.weekend_id)) throw forbidden('Access denied');
  if (p.kind === 'pending') throw new ApiError('Confirm the entry first', 400, 'not_confirmed');
  return placeIn(p.id, text(args.p_room_id) || null, getWeekend(p.weekend_id)!, uid);
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
  const { uid, weekend, manager, mine } = roomAccess(args);
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
    self: account === uid || mine?.id === target.id,
    contacts,
  };
};

// ---------------------------------------------------------------------------
// The shared link to the room choice
// ---------------------------------------------------------------------------

// Managers create (or replace — the old link stops working) and switch off
// the weekend's link. Guests who joined keep their place either way.
const weekend_link = (args: Args) => {
  const weekend = requireManagedWeekend(text(args.p_weekend_id));
  const token = args.p_action === 'disable' ? null : newSecret();
  db.prepare('update weekends set link_token = ? where id = ?').run(token, weekend.id);
  return { token };
};

const byLink = (token: string) => (token ? (db.prepare('select * from weekends where link_token = ?').get(token) as WeekendRow | undefined) : undefined);

// What the link's page shows before anyone joins: the weekend, whether its
// rooms are open, and who the caller already is — by account (on the list,
// or signed up and waiting to be resolved) or as a guest by their key.
const weekend_link_info = (args: Args) => {
  const weekend = byLink(text(args.p_token));
  if (!weekend || weekend.archived) return { state: 'invalid' as const };
  const uid = authUid();
  const project = db.prepare('select name, image_url from projects where id = ?').get(weekend.project_id) as {
    name: string;
    image_url: string | null;
  };
  const guest = guestByKey(text(args.p_guest_key));
  const account = uid ? (db.prepare('select name, email from app_users where id = ?').get(uid) as { name: string; email: string } | undefined) : undefined;
  return {
    state: 'ok' as const,
    weekend: {
      id: weekend.id,
      project_id: weekend.project_id,
      title: weekend.title,
      starts_on: weekend.starts_on,
      ends_on: weekend.ends_on,
      location: weekend.location,
      days: weekend.days,
      rooms_status: weekend.rooms_status,
    },
    project,
    account: account
      ? {
          name: account.name || account.email,
          listed: Boolean(myEntry(weekend.id, uid!)),
          pending: Boolean(
            db.prepare(`select 1 from weekend_participants where weekend_id = ? and user_id = ? and kind = 'pending'`).get(weekend.id, uid),
          ),
        }
      : null,
    guest: guest && guest.weekend_id === weekend.id ? { name: guest.name, pending: guest.kind === 'pending' } : null,
  };
};

// Chosen nights within the weekend, or null.
const chosenNights = (weekend: WeekendRow, from: unknown, to: unknown) => {
  const a = Number(from);
  const b = Number(to);
  const last = nightCount(weekend) - 1;
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < a || b > last) return null;
  return { night_from: a, night_to: b };
};

// The entry on the list a guest's name stands for: exactly one with that
// name (as listed or as imported) that nobody has claimed yet — neither by
// an account nor by another browser's key.
const unclaimedByName = (weekendId: string, name: string) => {
  const found = (
    db
      .prepare(
        `select wp.*, m.user_id as member_user from weekend_participants wp left join members m on m.id = wp.member_id
         where wp.weekend_id = ? and wp.guest_key_hash is null`,
      )
      .all(weekendId) as Array<ParticipantRow & { member_user: string | null }>
  ).filter((p) => sameName(p.name, name) || sameName(p.source_name, name));
  return found.length === 1 ? found[0] : found.length > 1 ? 'several' : undefined;
};

// Joining through the link while the rooms are open — only people on the
// list choose a room. With an account: one's entry, else an entry with the
// same email still without an account (taken over). As a guest: the one
// unclaimed entry with that name, which this browser's key then belongs to.
// Nights are asked for ('needs_nights') when the entry has no booked period.
// Whoever isn't found is put on the list as unresolved ('pending', with the
// chosen nights): the managers assign them — or delete the entry.
const weekend_link_join = (args: Args) => {
  const weekend = byLink(text(args.p_token));
  if (!weekend || !roomsOpen(weekend)) throw forbidden('The room choice is not open');
  const where = { project_id: weekend.project_id, weekend_id: weekend.id };
  const nights = chosenNights(weekend, args.p_night_from, args.p_night_to);
  const setNights = (id: string) =>
    nights && db.prepare('update weekend_participants set night_from = ?, night_to = ? where id = ?').run(nights.night_from, nights.night_to, id);
  // Known nights: a booked period or nights chosen before.
  const knowsNights = (p: ParticipantRow) => Boolean(p.booking) || p.night_from != null;

  if (args.p_mode === 'account') {
    const uid = requireUser();
    if (myEntry(weekend.id, uid)) return { state: 'ok' as const, ...where };
    const waiting = db
      .prepare(`select id from weekend_participants where weekend_id = ? and user_id = ? and kind = 'pending'`)
      .get(weekend.id, uid) as { id: string } | undefined;
    if (waiting) return { state: 'pending' as const, ...where };
    const email = normalizeEmail((db.prepare('select email from app_users where id = ?').get(uid) as { email: string }).email);
    const person = personFor(weekend.project_id, null, uid);
    const unclaimed = db
      .prepare(
        `select * from weekend_participants where weekend_id = ? and user_id is null and member_id is null
           and guest_key_hash is null and (lower(email) = ? or lower(source_email) = ?) limit 1`,
      )
      .get(weekend.id, email, email) as ParticipantRow | undefined;
    if (unclaimed) {
      if (!knowsNights(unclaimed) && !nights) return { state: 'needs_nights' as const };
      db.prepare(
        `update weekend_participants set kind = 'member', member_id = @member_id, user_id = @user_id, name = @name,
           email = @email, group_name = coalesce(@group_name, group_name), updated_at = @now where id = @id`,
      ).run({ ...person, now: nowIso(), id: unclaimed.id });
      if (!knowsNights(unclaimed)) setNights(unclaimed.id);
      return { state: 'ok' as const, ...where };
    }
    if (!nights) return { state: 'needs_nights' as const };
    const id = insertParticipant({ weekend_id: weekend.id, kind: 'pending', name: person.name, email: person.email, group_name: person.group_name });
    // Kept with the account, so confirming it needs no search.
    db.prepare('update weekend_participants set user_id = ? where id = ?').run(uid, id);
    setNights(id);
    auditNote({ action: 'weekend.link_pending', details: { weekend_id: weekend.id } });
    return { state: 'pending' as const, ...where };
  }

  const name = text(args.p_name).trim().replace(/\s+/g, ' ').slice(0, 200);
  if (!name) throw new ApiError('A guest needs a name', 400, '23514');
  const match = unclaimedByName(weekend.id, name);
  // Someone with an account signs in instead.
  if (match && match !== 'several' && (match.user_id || match.member_user)) return { state: 'account_required' as const };
  const found = match && match !== 'several' ? match : undefined;
  if (!(found && knowsNights(found)) && !nights) return { state: 'needs_nights' as const };
  const key = newSecret(24);
  const id =
    found?.id ??
    insertParticipant({ weekend_id: weekend.id, kind: 'pending', name, source_name: name });
  db.prepare('update weekend_participants set guest_key_hash = ? where id = ?').run(sha256(key), id);
  if (!found || !knowsNights(found)) setNights(id);
  const pending = !found || found.kind === 'pending';
  auditNote({ action: pending ? 'weekend.link_pending' : 'weekend.link_guest', details: { weekend_id: weekend.id } });
  return { state: pending ? ('pending' as const) : ('ok' as const), ...where, guest_key: key };
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
  // The booked period as the import had it.
  booking: string;
}

const entriesOf = (value: unknown): Entry[] =>
  (Array.isArray(value) ? value.slice(0, 2000) : [])
    .filter(isObj)
    .map((e) => ({
      name: text(e.name).trim().slice(0, 200),
      email: normalizeEmail(e.email).slice(0, 254),
      group: text(e.group).trim().slice(0, 120),
      booking: text(e.booking).trim().replace(/\s+/g, ' ').slice(0, 200),
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
  booking?: string | null;
}) =>
  (
    db
      .prepare(
        `insert into weekend_participants
           (weekend_id, kind, member_id, user_id, name, email, group_name, source_name, source_email, import_id, changed_by_hand, booking)
         values (@weekend_id, @kind, @member_id, @user_id, @name, @email, @group_name, @source_name, @source_email, @import_id, @changed_by_hand, @booking)
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
        booking: null,
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
// skipped. Lines whose person is listed already are recognised, not doubled
// — they only take over the line's booked period if they have none yet.
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
    const source = { source_name: entry.name || null, source_email: entry.email || null, import_id: importId, booking: entry.booking || null };
    const recognized = (id: string) => {
      if (entry.booking) db.prepare('update weekend_participants set booking = ? where id = ? and booking is null').run(entry.booking, id);
      stats.recognized++;
    };
    if (action === 'link' || action === 'new_member') {
      let memberId = text(row.member_id) || null;
      const userId = text(row.user_id) || null;
      if (action === 'new_member') {
        const { first, last } = splitName(entry.name || entry.email.split('@')[0]);
        memberId = registrationToMember(weekend.project_id, first, last, knownGroup(weekend.project_id, entry.group), entry.email || null, null);
        stats.new_members++;
      }
      const person = personFor(weekend.project_id, memberId, memberId ? null : userId);
      const listed = findListed(weekend.id, person.member_id, person.user_id);
      if (listed) {
        recognized(listed.id);
        continue;
      }
      insertParticipant({ weekend_id: weekend.id, kind: 'member', ...person, ...source });
      stats.new++;
      continue;
    }
    const listed = listedAs(db.prepare('select * from weekend_participants where weekend_id = ?').all(weekend.id) as ParticipantRow[], entry);
    if (listed) {
      // Guests and open lines already on the list: recognised, not doubled.
      recognized(listed.id);
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
// (only for the weekend), confirm it with the account it came with (signed
// up on the link), merge it into an entry already on the list (it takes
// over the link's key, account and nights), or take the person over as a
// new project member.
const weekend_resolve_participant = (args: Args) => {
  const p = db.prepare('select * from weekend_participants where id = ?').get(text(args.p_participant_id)) as
    | ParticipantRow
    | undefined;
  if (!p) throw new ApiError('Not found', 404);
  const weekend = requireManagedWeekend(p.weekend_id);
  const action = text(args.p_action);
  if (action === 'confirm') {
    if (!p.user_id) throw new ApiError('No account to confirm', 400);
    const person = personFor(weekend.project_id, null, p.user_id);
    db.prepare(
      `update weekend_participants set kind = 'member', member_id = @member_id, name = @name, email = @email,
         group_name = @group_name, changed_by_hand = 1, updated_at = @now where id = @id`,
    ).run({ ...person, now: nowIso(), id: p.id });
    return { ok: true };
  }
  if (action === 'merge') {
    const target = db
      .prepare(`select * from weekend_participants where id = ? and weekend_id = ? and id <> ?`)
      .get(text(args.p_target_id), p.weekend_id, p.id) as ParticipantRow | undefined;
    if (!target) throw new ApiError('Unknown entry', 400);
    if (p.user_id && target.user_id && p.user_id !== target.user_id) throw new ApiError('Both entries have an account', 409, 'two_accounts');
    db.prepare('delete from weekend_participants where id = ?').run(p.id);
    db.prepare(
      `update weekend_participants set
         guest_key_hash = coalesce(@key, guest_key_hash),
         user_id = coalesce(user_id, @user_id),
         night_from = case when booking is null and night_from is null then @from else night_from end,
         night_to = case when booking is null and night_from is null then @to else night_to end,
         changed_by_hand = 1, updated_at = @now
       where id = @id`,
    ).run({ key: p.guest_key_hash, user_id: p.user_id, from: p.night_from, to: p.night_to, now: nowIso(), id: target.id });
    return { ok: true };
  }
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
  if (listed && listed.id !== p.id) {
    // A sign-up from the link for someone listed already: merged into them.
    if (p.guest_key_hash || p.user_id) return weekend_resolve_participant({ p_participant_id: p.id, p_action: 'merge', p_target_id: listed.id });
    throw new ApiError('This person is on the list already', 409, 'already_listed');
  }
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
    .prepare('select * from weekends where project_id = ? and not archived')
    .all(projectId) as WeekendRow[];
  const shownOnes = weekends.filter(shown);
  const confirmed = shownOnes.filter((w) => myEntry(w.id, uid));
  return {
    weekend: manager || (shownOnes.length > 0 && (participant || confirmed.length > 0)),
    room_missing: confirmed.filter((w) => roomsOpen(w) && roomMissing(w.id, uid)).length,
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
         where w.rooms_status = 'open' and not w.archived and p.status = 'active' and p.show_weekend`,
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
  weekend_link,
  weekend_link_info,
  weekend_link_join,
};

// Reached without an account (rate limited by the HTTP layer).
export const WEEKEND_PUBLIC_WRITE_FUNCTIONS = ['weekend_link_join'];

export const WEEKEND_READ_FUNCTIONS = ['weekend_list', 'weekend_rooms_view', 'weekend_person', 'weekend_import_preview', 'weekend_link_info'];
