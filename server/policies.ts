// Row-level access control, ported from the former Postgres RLS policies.
//
// Every policy is a SQL predicate over a table alias. The data API applies:
//   select → rows must satisfy `select`
//   update → target rows must satisfy `update`, changed rows must satisfy `check`
//   delete → target rows must satisfy `delete`
//   insert → new rows must satisfy `insert`
// A missing predicate denies the operation. auth_uid() is the calling user.
import { ApiError } from './db.ts';

type Predicate = (alias: string) => string;

export interface TablePolicy {
  select?: Predicate;
  insert?: Predicate;
  update?: Predicate;
  check?: Predicate;
  delete?: Predicate;
  // Extra validation of an update against the stored row (runs per row).
  validateUpdate?: (
    oldRow: Record<string, unknown>,
    patch: Record<string, unknown>,
    ctx: { uid: string; isAdmin: boolean },
  ) => void;
}

// --- helpers (formerly security-definer SQL functions) ----------------------

export const isAdmin = () =>
  `exists (select 1 from app_users _u where _u.id = auth_uid() and _u.is_admin)`;

export const canManageProjects = () =>
  `exists (select 1 from app_users _u where _u.id = auth_uid() and (_u.is_admin or _u.can_manage_projects))`;

// Management access to a project: admin, or project manager whose scope
// covers the project.
export const canAccessProject = (pid: string) => `exists (
  select 1 from app_users _u
  where _u.id = auth_uid()
    and (_u.is_admin or (_u.can_manage_projects and (
      _u.all_projects
      or exists (select 1 from user_projects _up where _up.user_id = _u.id and _up.project_id = ${pid})
    )))
)`;

// Participant access: an active linked member row in a project that allows
// account access.
export const isProjectParticipant = (pid: string) => `exists (
  select 1 from members _m join projects _p on _p.id = _m.project_id
  where _m.project_id = ${pid} and _m.user_id = auth_uid()
    and _m.status = 'active' and _p.allow_account_access
)`;

const participantCanSeePieces = (pid: string) => `(${isProjectParticipant(pid)} and exists (
  select 1 from projects _pp where _pp.id = ${pid} and _pp.allow_participant_pieces
))`;

export const canAccessClub = () =>
  `exists (select 1 from app_users _u where _u.id = auth_uid() and (_u.is_admin or _u.can_access_club))`;

const eventInManagedProject = (eventId: string) =>
  `exists (select 1 from events _e where _e.id = ${eventId} and ${canAccessProject('_e.project_id')})`;

const pageInManagedProject = (pageId: string) =>
  `exists (select 1 from registration_pages _rp where _rp.id = ${pageId} and ${canAccessProject('_rp.project_id')})`;

const or = (...parts: string[]) => parts.map((p) => `(${p})`).join(' or ');

// Same predicate for every operation (Postgres "for all ... using/with check").
const all = (p: Predicate): TablePolicy => ({ select: p, insert: p, update: p, check: p, delete: p });

// --- policies ---------------------------------------------------------------

const PROTECTED_ACCOUNT_FIELDS = [
  'id',
  'email',
  'is_admin',
  'can_manage_projects',
  'can_access_club',
  'all_projects',
] as const;

export const policies: Record<string, TablePolicy> = {
  // Users read their own profile; admins read and manage everyone. Accounts
  // are created and deleted only through the auth/admin endpoints.
  app_users: {
    select: (a) => or(`${a}.id = auth_uid()`, isAdmin()),
    update: (a) => or(`${a}.id = auth_uid()`, isAdmin()),
    check: () => 'true',
    validateUpdate: (oldRow, patch, { uid, isAdmin: admin }) => {
      const self = oldRow.id === uid;
      for (const field of PROTECTED_ACCOUNT_FIELDS) {
        if (!(field in patch)) continue;
        const changed = normalize(patch[field]) !== normalize(oldRow[field]);
        if (!changed) continue;
        // Nobody edits ids or emails here (email changes go through auth).
        if (field === 'id' || field === 'email' || !admin) {
          throw new ApiError('new row violates row-level security policy for table "app_users"', 403, '42501');
        }
        if (self && field === 'is_admin') {
          throw new ApiError('You cannot remove your own administrator access', 403, '42501');
        }
      }
    },
  },

  app_settings: {
    select: () => 'true',
    insert: isAdmin,
    update: isAdmin,
    check: isAdmin,
    delete: isAdmin,
  },

  projects: {
    select: (a) => or(canAccessProject(`${a}.id`), isProjectParticipant(`${a}.id`)),
    insert: canManageProjects,
    update: (a) => canAccessProject(`${a}.id`),
    check: () => 'true',
    delete: (a) => canAccessProject(`${a}.id`),
  },

  user_projects: {
    select: (a) => or(`${a}.user_id = auth_uid()`, isAdmin()),
    insert: isAdmin,
    update: isAdmin,
    check: isAdmin,
    delete: isAdmin,
  },

  members: {
    ...all((a) => canAccessProject(`${a}.project_id`)),
    // Participants always see their own member row (also after leaving).
    select: (a) => or(canAccessProject(`${a}.project_id`), `${a}.user_id = auth_uid()`),
  },

  events: {
    ...all((a) => canAccessProject(`${a}.project_id`)),
    select: (a) => or(canAccessProject(`${a}.project_id`), isProjectParticipant(`${a}.project_id`)),
  },

  attendance: {
    ...all((a) => eventInManagedProject(`${a}.event_id`)),
    select: (a) =>
      or(
        eventInManagedProject(`${a}.event_id`),
        `exists (select 1 from members _om where _om.id = ${a}.member_id and _om.user_id = auth_uid())`,
      ),
  },

  event_checkins: all((a) => eventInManagedProject(`${a}.event_id`)),

  // Submissions are only written by the public check-in functions.
  checkin_submissions: {
    select: (a) => eventInManagedProject(`${a}.event_id`),
    delete: (a) => eventInManagedProject(`${a}.event_id`),
  },

  // Participants read the groups to pick their own on "My participation".
  project_groups: {
    ...all((a) => canAccessProject(`${a}.project_id`)),
    select: (a) => or(canAccessProject(`${a}.project_id`), isProjectParticipant(`${a}.project_id`)),
  },

  registration_pages: all((a) => canAccessProject(`${a}.project_id`)),

  registrations: all((a) => pageInManagedProject(`${a}.registration_page_id`)),

  club_members: all(() => canAccessClub()),

  pieces: {
    ...all((a) => canAccessProject(`${a}.project_id`)),
    select: (a) => or(canAccessProject(`${a}.project_id`), participantCanSeePieces(`${a}.project_id`)),
  },

  piece_blocks: {
    ...all(
      (a) => `exists (select 1 from pieces _pc where _pc.id = ${a}.piece_id and ${canAccessProject('_pc.project_id')})`,
    ),
    select: (a) => `exists (
      select 1 from pieces _pc where _pc.id = ${a}.piece_id
        and (${canAccessProject('_pc.project_id')} or ${participantCanSeePieces('_pc.project_id')})
    )`,
  },

  absence_labels: {
    ...all((a) => canAccessProject(`${a}.project_id`)),
    select: (a) =>
      or(canAccessProject(`${a}.project_id`), `${a}.is_public and ${isProjectParticipant(`${a}.project_id`)}`),
  },
};

const normalize = (v: unknown) => (typeof v === 'boolean' ? (v ? 1 : 0) : v ?? null);
