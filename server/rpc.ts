// Server-side functions, ported from the former Postgres security-definer
// functions. They run with full database access (like `security definer`) and
// do their own authorization. Each call runs in one transaction.
import { db, authUid, ApiError, forbidden } from './db.ts';
import { canAccessProject, canManageProjects } from './policies.ts';

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const trimmed = (value: unknown) => text(value).trim();
const optional = (value: unknown) => trimmed(value) || null;
const same = (a: unknown, b: unknown) => trimmed(a).toLowerCase() === trimmed(b).toLowerCase();

const requireUser = () => {
  const uid = authUid();
  if (!uid) throw new ApiError('Authentication required', 401, '42501');
  return uid;
};

const check = (sql: string, params?: Args) => {
  const statement = db.prepare(`select (${sql}) as v`);
  const row = (params ? statement.get(params) : statement.get()) as { v: number };
  return Boolean(row.v);
};

const userCanAccessProject = (pid: unknown) => check(canAccessProject('@pid'), { pid: text(pid) });

const parseGroups = (raw: unknown): string[] => {
  try {
    const parsed = JSON.parse(text(raw) || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

const accountEmail = (uid: string) =>
  (db.prepare('select email from auth_users where id = ?').get(uid) as { email: string } | undefined)?.email ?? null;

const insertMember = (row: {
  project_id: string;
  first_name: string;
  last_name: string;
  group_name: string | null;
  email: string | null;
  user_id?: string | null;
}) =>
  (
    db
      .prepare(
        `insert into members (project_id, first_name, last_name, group_name, email, status, user_id)
         values (@project_id, @first_name, @last_name, @group_name, @email, 'active', @user_id)
         returning id`,
      )
      .get({ user_id: null, ...row }) as { id: string }
  ).id;

const upsertAttendance = (eventId: string, memberId: string, status: string) =>
  db
    .prepare(
      `insert into attendance (event_id, member_id, status, is_guest) values (?, ?, ?, 0)
       on conflict (event_id, member_id) do update set status = excluded.status, is_guest = 0`,
    )
    .run(eventId, memberId, status);

// A registration becomes a member; an account that already has a member row in
// the project gets that row re-activated instead (one link per project).
const registrationToMember = (
  projectId: string,
  firstName: string,
  lastName: string,
  groupName: string | null,
  email: string | null,
  userId: string | null,
) => {
  if (userId) {
    const existing = db
      .prepare('select id from members where project_id = ? and user_id = ?')
      .get(projectId, userId) as { id: string } | undefined;
    if (existing) {
      db.prepare(
        `update members set status = 'active', group_name = coalesce(?, group_name) where id = ?`,
      ).run(groupName, existing.id);
      return existing.id;
    }
  }
  return insertMember({
    project_id: projectId,
    first_name: firstName,
    last_name: lastName,
    group_name: groupName,
    email,
    user_id: userId,
  });
};

const tooLong = (value: string | null, max: number) => (value ?? '').length > max;

// ---------------------------------------------------------------------------
// Public (anonymous) functions
// ---------------------------------------------------------------------------

const get_public_config = () => {
  const row = db.prepare('select allow_self_signup from app_settings where id = 1').get() as
    | { allow_self_signup: number }
    | undefined;
  return { allow_self_signup: row ? Boolean(row.allow_self_signup) : true };
};

const get_public_checkin = (args: Args) => {
  const checkin = db
    .prepare(
      `select c.event_id, c.is_active, e.name as event_name, e.project_id,
              p.name as project_name, p.groups as project_groups,
              p.allow_guest_checkin, p.allow_account_checkin
       from event_checkins c
       join events e on e.id = c.event_id
       join projects p on p.id = e.project_id
       where c.token = ?`,
    )
    .get(text(args.p_token)) as Row | undefined;

  if (!checkin) return { state: 'invalid' };
  if (!checkin.is_active) {
    return { state: 'stopped', event_name: checkin.event_name, project_name: checkin.project_name };
  }

  const groups = parseGroups(checkin.project_groups);

  // Logged-in visitors get their linked member for a one-tap check-in.
  const uid = authUid();
  let me: Row | null = null;
  if (uid) {
    const member = db
      .prepare('select first_name, last_name, group_name, status from members where project_id = ? and user_id = ?')
      .get(checkin.project_id, uid) as Row | undefined;
    if (member) {
      me = {
        first_name: member.first_name,
        last_name: member.last_name,
        group_name: member.group_name,
        participating: member.status === 'active',
      };
    }
  }

  return {
    state: 'active',
    event_name: checkin.event_name,
    project_name: checkin.project_name,
    groups,
    allow_guest_checkin: Boolean(checkin.allow_guest_checkin),
    allow_account_checkin: Boolean(checkin.allow_account_checkin),
    logged_in: uid !== null,
    me,
  };
};

const submit_public_checkin = (args: Args) => {
  const firstName = trimmed(args.p_first_name);
  const lastName = trimmed(args.p_last_name);
  const groupName = trimmed(args.p_group_name);

  const checkin = db
    .prepare(
      `select c.event_id, c.is_active, c.attendance_status, e.project_id,
              p.allow_guest_checkin, p.allow_account_checkin
       from event_checkins c
       join events e on e.id = c.event_id
       join projects p on p.id = e.project_id
       where c.token = ?`,
    )
    .get(text(args.p_token)) as
    | {
        event_id: string;
        is_active: number;
        attendance_status: string;
        project_id: string;
        allow_guest_checkin: number;
        allow_account_checkin: number;
      }
    | undefined;

  if (!checkin) return { state: 'invalid' };
  if (!checkin.is_active) return { state: 'stopped' };

  const uid = authUid();

  // Account check-in: use (or create) the caller's linked member row.
  if (args.p_as_account === true && uid) {
    if (!checkin.allow_account_checkin) return { state: 'not_allowed' };

    const existing = db
      .prepare('select id, status from members where project_id = ? and user_id = ?')
      .get(checkin.project_id, uid) as { id: string; status: string } | undefined;

    let memberId: string;
    if (!existing) {
      // First contact with this project: joining happens implicitly.
      if (!firstName || !lastName || tooLong(firstName, 120) || tooLong(lastName, 120) || tooLong(groupName, 120)) {
        return { state: 'invalid_input' };
      }
      memberId = insertMember({
        project_id: checkin.project_id,
        first_name: firstName,
        last_name: lastName,
        group_name: groupName || null,
        email: accountEmail(uid),
        user_id: uid,
      });
    } else {
      memberId = existing.id;
      if (existing.status !== 'active') {
        db.prepare(`update members set status = 'active' where id = ?`).run(memberId);
      }
    }

    upsertAttendance(checkin.event_id, memberId, checkin.attendance_status);
    db.prepare(
      `insert into checkin_submissions
         (event_id, member_id, first_name, last_name, group_name, recognized, attendance_status)
       select ?, m.id, m.first_name, m.last_name, coalesce(m.group_name, ''), 1, ?
       from members m where m.id = ?`,
    ).run(checkin.event_id, checkin.attendance_status, memberId);

    return { state: 'success', recognized: true };
  }

  // Guest check-in.
  if (!checkin.allow_guest_checkin) return { state: 'not_allowed' };
  if (!firstName || !lastName || !groupName || tooLong(firstName, 120) || tooLong(lastName, 120) || tooLong(groupName, 120)) {
    return { state: 'invalid_input' };
  }

  // Match first AND last name (case-insensitive) AND exact group.
  const candidates = db
    .prepare(
      `select id, first_name, last_name from members
       where project_id = ? and status = 'active' and group_name = ?
       order by created_at`,
    )
    .all(checkin.project_id, groupName) as { id: string; first_name: string; last_name: string }[];
  const match = candidates.find((m) => same(m.first_name, firstName) && same(m.last_name, lastName));

  if (match) {
    upsertAttendance(checkin.event_id, match.id, checkin.attendance_status);
    db.prepare(
      `insert into checkin_submissions
         (event_id, member_id, first_name, last_name, group_name, recognized, attendance_status)
       values (?, ?, ?, ?, ?, 1, ?)`,
    ).run(checkin.event_id, match.id, firstName, lastName, groupName, checkin.attendance_status);
    return { state: 'success', recognized: true };
  }

  db.prepare(
    `insert into checkin_submissions (event_id, first_name, last_name, group_name, recognized)
     values (?, ?, ?, ?, 0)`,
  ).run(checkin.event_id, firstName, lastName, groupName);
  return { state: 'success', recognized: false };
};

const get_public_registration = (args: Args) => {
  const page = db
    .prepare(
      `select rp.id, rp.is_active, rp.title, rp.description, rp.ask_email, rp.ask_group,
              rp.project_id, p.name as project_name, p.groups as project_groups,
              p.allow_guest_signup, p.allow_account_signup
       from registration_pages rp
       join projects p on p.id = rp.project_id
       where rp.token = ?`,
    )
    .get(text(args.p_token)) as Row | undefined;

  if (!page) return { state: 'invalid' };
  if (!page.is_active) return { state: 'inactive', title: page.title, project_name: page.project_name };

  const groups = parseGroups(page.project_groups);

  const uid = authUid();
  let me: Row | null = null;
  if (uid) {
    const user = db
      .prepare(
        `select u.name, au.email,
                exists (select 1 from members m
                        where m.project_id = ? and m.user_id = u.id and m.status = 'active') as participating
         from app_users u join auth_users au on au.id = u.id
         where u.id = ?`,
      )
      .get(page.project_id, uid) as Row | undefined;
    if (user) me = { name: user.name, email: user.email, participating: Boolean(user.participating) };
  }

  return {
    state: 'active',
    title: page.title,
    description: page.description,
    ask_email: Boolean(page.ask_email),
    ask_group: Boolean(page.ask_group),
    groups,
    project_name: page.project_name,
    allow_guest_signup: Boolean(page.allow_guest_signup),
    allow_account_signup: Boolean(page.allow_account_signup),
    logged_in: uid !== null,
    me,
  };
};

const submit_public_registration = (args: Args) => {
  const firstName = trimmed(args.p_first_name);
  const lastName = trimmed(args.p_last_name);
  let email = optional(args.p_email);
  let groupName = optional(args.p_group_name);
  const uid = authUid();
  const asAccount = args.p_as_account === true && uid !== null;

  if (!firstName || !lastName || tooLong(firstName, 120) || tooLong(lastName, 120) || tooLong(email, 200) || tooLong(groupName, 120)) {
    return { state: 'invalid_input' };
  }

  const page = db
    .prepare(
      `select rp.id, rp.project_id, rp.is_active, rp.ask_email, rp.ask_group, rp.auto_transfer,
              p.allow_guest_signup, p.allow_account_signup
       from registration_pages rp
       join projects p on p.id = rp.project_id
       where rp.token = ?`,
    )
    .get(text(args.p_token)) as
    | {
        id: string;
        project_id: string;
        is_active: number;
        ask_email: number;
        ask_group: number;
        auto_transfer: number;
        allow_guest_signup: number;
        allow_account_signup: number;
      }
    | undefined;

  if (!page) return { state: 'invalid' };
  if (!page.is_active) return { state: 'inactive' };
  if (asAccount && !page.allow_account_signup) return { state: 'not_allowed' };
  if (!asAccount && !page.allow_guest_signup) return { state: 'not_allowed' };

  // The account's verified address always wins over a typed one.
  if (asAccount) email = accountEmail(uid!);
  else if (!page.ask_email) email = null;
  if (!page.ask_group) groupName = null;

  // Membership only happens through the transfer, never at submission time.
  const accountId = asAccount ? uid : null;
  const memberId = page.auto_transfer
    ? registrationToMember(page.project_id, firstName, lastName, groupName, email, accountId)
    : null;

  db.prepare(
    `insert into registrations
       (registration_page_id, first_name, last_name, email, group_name, member_id, transferred, user_id)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(page.id, firstName, lastName, email, groupName, memberId, memberId ? 1 : 0, accountId);

  return { state: 'success' };
};

// ---------------------------------------------------------------------------
// Authenticated functions
// ---------------------------------------------------------------------------

const can_access_project = (args: Args) => {
  requireUser();
  return userCanAccessProject(args.pid);
};

const assign_checkin_submission = (args: Args) => {
  requireUser();
  const submission = db
    .prepare(
      `select s.event_id, e.project_id, c.attendance_status
       from checkin_submissions s
       join events e on e.id = s.event_id
       join event_checkins c on c.event_id = s.event_id
       where s.id = ? and not s.recognized`,
    )
    .get(text(args.p_submission_id)) as
    | { event_id: string; project_id: string; attendance_status: string }
    | undefined;
  if (!submission) throw new ApiError('Check-in submission not found');
  if (!userCanAccessProject(submission.project_id)) throw forbidden('Project access denied');

  const member = db
    .prepare(`select id from members where id = ? and project_id = ? and status = 'active'`)
    .get(text(args.p_member_id), submission.project_id) as { id: string } | undefined;
  if (!member) throw new ApiError('Member not found in this project');

  upsertAttendance(submission.event_id, member.id, submission.attendance_status);
  db.prepare(
    `update checkin_submissions set member_id = ?, recognized = 1, attendance_status = ? where id = ?`,
  ).run(member.id, submission.attendance_status, text(args.p_submission_id));
  return { success: true };
};

const transfer_registration = (args: Args) => {
  requireUser();
  const reg = db
    .prepare(
      `select r.id, r.first_name, r.last_name, r.email, r.group_name, r.transferred, r.user_id, rp.project_id
       from registrations r
       join registration_pages rp on rp.id = r.registration_page_id
       where r.id = ?`,
    )
    .get(text(args.p_registration_id)) as Row | undefined;
  if (!reg) throw new ApiError('Registration not found');
  if (!userCanAccessProject(reg.project_id)) throw forbidden('Project access denied');
  if (reg.transferred) return { success: true, transferred: 0 };

  const memberId = registrationToMember(
    text(reg.project_id),
    text(reg.first_name),
    text(reg.last_name),
    reg.group_name as string | null,
    reg.email as string | null,
    reg.user_id as string | null,
  );
  db.prepare('update registrations set transferred = 1, member_id = ? where id = ?').run(memberId, reg.id);
  return { success: true, transferred: 1 };
};

const transfer_all_registrations = (args: Args) => {
  requireUser();
  const page = db.prepare('select project_id from registration_pages where id = ?').get(text(args.p_page_id)) as
    | { project_id: string }
    | undefined;
  if (!page) throw new ApiError('Registration page not found');
  if (!userCanAccessProject(page.project_id)) throw forbidden('Project access denied');

  const regs = db
    .prepare(
      `select id, first_name, last_name, email, group_name, user_id
       from registrations where registration_page_id = ? and not transferred
       order by created_at`,
    )
    .all(text(args.p_page_id)) as Row[];
  const mark = db.prepare('update registrations set transferred = 1, member_id = ? where id = ?');
  for (const reg of regs) {
    const memberId = registrationToMember(
      page.project_id,
      text(reg.first_name),
      text(reg.last_name),
      reg.group_name as string | null,
      reg.email as string | null,
      reg.user_id as string | null,
    );
    mark.run(memberId, reg.id);
  }
  return { success: true, transferred: regs.length };
};

// Attaches unlinked member rows whose email matches the caller's confirmed
// email: the oldest matching row per project, never a second link.
const claim_my_memberships = () => {
  const uid = requireUser();
  const account = db
    .prepare('select email from auth_users where id = ? and email_confirmed_at is not null')
    .get(uid) as { email: string } | undefined;
  if (!account) return null;

  const candidates = db
    .prepare(
      `select m.id, m.project_id from members m
       where m.user_id is null and ulower(trim(coalesce(m.email, ''))) = ulower(?)
         and not exists (select 1 from members m2 where m2.project_id = m.project_id and m2.user_id = ?)
       order by m.created_at`,
    )
    .all(account.email.trim(), uid) as { id: string; project_id: string }[];

  const link = db.prepare('update members set user_id = ? where id = ?');
  const linkedProjects = new Set<string>();
  for (const candidate of candidates) {
    if (linkedProjects.has(candidate.project_id)) continue;
    link.run(uid, candidate.id);
    linkedProjects.add(candidate.project_id);
  }
  return null;
};

// Join a project. Managers may join any project they manage; a plain account
// may only re-activate an existing link.
const join_project = (args: Args) => {
  const uid = requireUser();
  const project = db.prepare('select id, groups from projects where id = ?').get(text(args.p_project_id)) as
    | { id: string; groups: string }
    | undefined;
  if (!project) return { state: 'invalid' };

  const member = db
    .prepare('select id from members where project_id = ? and user_id = ?')
    .get(project.id, uid) as { id: string } | undefined;
  if (!member && !userCanAccessProject(project.id)) throw forbidden('Project access denied');

  const groupName = optional(args.p_group_name);
  const groups = parseGroups(project.groups);
  if (groupName && groups.length && !groups.includes(groupName)) return { state: 'invalid_group' };

  if (member) {
    db.prepare(
      `update members set status = 'active', group_name = coalesce(?, group_name) where id = ?`,
    ).run(groupName, member.id);
    return { state: 'success', member_id: member.id };
  }

  const firstName = trimmed(args.p_first_name);
  const lastName = trimmed(args.p_last_name);
  if (!firstName || !lastName || tooLong(firstName, 120) || tooLong(lastName, 120)) {
    return { state: 'invalid_input' };
  }
  const memberId = insertMember({
    project_id: project.id,
    first_name: firstName,
    last_name: lastName,
    group_name: groupName,
    email: accountEmail(uid),
    user_id: uid,
  });
  return { state: 'success', member_id: memberId };
};

// Leaving archives the member row so history survives and re-joining works.
const leave_project = (args: Args) => {
  const uid = requireUser();
  const { changes } = db
    .prepare(
      `update members set status = 'archived'
       where project_id = ? and user_id = ? and status <> 'archived'`,
    )
    .run(text(args.p_project_id), uid);
  return { state: changes ? 'success' : 'not_participating' };
};

const set_my_group = (args: Args) => {
  const uid = requireUser();
  const project = db.prepare('select groups from projects where id = ?').get(text(args.p_project_id)) as
    | { groups: string }
    | undefined;
  if (!project) return { state: 'invalid' };

  const groupName = optional(args.p_group_name);
  const groups = parseGroups(project.groups);
  // Participants pick one of the project's groups; clearing it isn't allowed.
  if (groups.length && (!groupName || !groups.includes(groupName))) return { state: 'invalid_group' };

  const { changes } = db
    .prepare(
      `update members set group_name = ?
       where project_id = ? and user_id = ? and status = 'active'`,
    )
    .run(groupName, text(args.p_project_id), uid);
  return { state: changes ? 'success' : 'not_participating' };
};

// Replace a project's group list. `p_renames` maps previous names to their new
// name (or null when removed); members follow along, and members left in a
// group that no longer exists lose their group.
const set_project_groups = (args: Args) => {
  requireUser();
  const projectId = text(args.p_project_id);
  if (!userCanAccessProject(projectId)) throw forbidden('Project access denied');
  const raw = Array.isArray(args.p_groups) ? args.p_groups : [];
  const groups = [...new Set(raw.map((g) => (typeof g === 'string' ? g.trim() : '')).filter(Boolean))];
  if (groups.some((g) => tooLong(g, 120))) return { state: 'invalid_input' };
  const renames =
    args.p_renames && typeof args.p_renames === 'object' && !Array.isArray(args.p_renames)
      ? (args.p_renames as Record<string, unknown>)
      : {};

  const members = db
    .prepare('select id, group_name from members where project_id = ? and group_name is not null')
    .all(projectId) as { id: string; group_name: string }[];
  const setGroup = db.prepare('update members set group_name = ? where id = ?');
  for (const m of members) {
    let next: string | null = m.group_name;
    if (Object.hasOwn(renames, m.group_name)) {
      const target = renames[m.group_name];
      next = typeof target === 'string' ? target.trim() || null : null;
    }
    if (next !== null && !groups.includes(next)) next = null;
    if (next !== m.group_name) setGroup.run(next, m.id);
  }
  db.prepare('update projects set groups = ? where id = ?').run(JSON.stringify(groups), projectId);
  return { state: 'success' };
};

// Managers look up accounts by name/email to add them as project members.
const search_accounts = (args: Args) => {
  requireUser();
  if (!check(canManageProjects())) throw forbidden('Access denied');
  const query = trimmed(args.p_query);
  if (!query) return [];
  return db
    .prepare(
      `select id, name, email from app_users
       where instr(ulower(name), ulower(@q)) > 0 or instr(ulower(email), ulower(@q)) > 0
       order by name collate nocase, email collate nocase
       limit 10`,
    )
    .all({ q: query });
};

// Account names behind linked members, so the UI can flag deviating names.
const linked_account_names = (args: Args) => {
  requireUser();
  if (!userCanAccessProject(args.p_project_id)) return [];
  return db
    .prepare(
      `select m.id as member_id, u.name as account_name
       from members m join app_users u on u.id = m.user_id
       where m.project_id = ?`,
    )
    .all(text(args.p_project_id));
};

const functions: Record<string, (args: Args) => unknown> = {
  get_public_config,
  get_public_checkin,
  submit_public_checkin,
  get_public_registration,
  submit_public_registration,
  can_access_project,
  assign_checkin_submission,
  transfer_registration,
  transfer_all_registrations,
  claim_my_memberships,
  join_project,
  leave_project,
  set_my_group,
  set_project_groups,
  search_accounts,
  linked_account_names,
};

// Public functions are rate limited by the HTTP layer.
export const PUBLIC_WRITE_FUNCTIONS = new Set(['submit_public_checkin', 'submit_public_registration']);

// Must run inside asUser().
export const callFunction = (name: string, args: Args) => {
  const fn = Object.hasOwn(functions, name) ? functions[name] : undefined;
  if (!fn) throw new ApiError(`Could not find the function ${name}`, 404, 'PGRST202');
  return db.transaction(() => fn(args ?? {}))();
};
