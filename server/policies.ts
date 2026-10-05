// Row-level access control, ported from the former Postgres RLS policies.
//
// Every policy is a SQL predicate over a table alias. The data API applies:
//   select → rows must satisfy `select`
//   update → target rows must satisfy `update`, changed rows must satisfy `check`
//   delete → target rows must satisfy `delete`
//   insert → new rows must satisfy `insert`
// A missing predicate denies the operation. auth_uid() is the calling user.
import { ApiError, db } from './db.ts';
import { MAX_SESSION_DAYS, MIN_SESSION_DAYS } from './settings.ts';
import { hasSecondFactor } from './mfa.ts';

type Predicate = (alias: string) => string;

export interface TablePolicy {
  select?: Predicate;
  insert?: Predicate;
  update?: Predicate;
  check?: Predicate;
  delete?: Predicate;
  // Extra validation of a new row's values.
  validateInsert?: (row: Record<string, unknown>) => void;
  // Extra validation of an update against the stored row (runs per row).
  validateUpdate?: (
    oldRow: Record<string, unknown>,
    patch: Record<string, unknown>,
    ctx: { uid: string; isAdmin: boolean },
  ) => void;
}

// --- helpers (formerly security-definer SQL functions) ----------------------

// Wrapped as a whole, so `x and ${or(a, b)}` means `x and (a or b)`.
const or = (...parts: string[]) => `(${parts.map((p) => `(${p})`).join(' or ')})`;

export const isAdmin = () =>
  `exists (select 1 from app_users _u where _u.id = auth_uid() and _u.is_admin)`;

// Access to every project (current and future); also required to create one.
export const canManageProjects = () =>
  `exists (select 1 from app_users _u where _u.id = auth_uid() and (_u.is_admin or _u.can_manage_projects))`;

// Management access to a project: admin, access to all projects, or an
// explicit user_projects grant for this one.
export const canAccessProject = (pid: string) => or(
  canManageProjects(),
  `exists (select 1 from user_projects _up where _up.user_id = auth_uid() and _up.project_id = ${pid})`,
);

// Management access to at least one project.
export const canManageAnyProject = () =>
  or(canManageProjects(), `exists (select 1 from user_projects _up where _up.user_id = auth_uid())`);

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

// --- pieces (one collection shared by all projects, see migration 0032) ----

// Edits every piece and opens the collection page: admins and the 'all' level.
export const hasFullPieceAccess = () =>
  `exists (select 1 from app_users _u where _u.id = auth_uid() and (_u.is_admin or _u.piece_access = 'all'))`;

// The 'projects' level: edits pieces of projects one manages.
const hasProjectPieceAccess = () =>
  `exists (select 1 from app_users _u where _u.id = auth_uid() and _u.piece_access = 'projects')`;

// Reading a piece: full access, or the piece is in a project one manages or
// takes part in (while that project shows its pieces to participants).
export const canSeePiece = (pieceId: string) => or(
  hasFullPieceAccess(),
  `exists (select 1 from project_pieces _pv where _pv.piece_id = ${pieceId}
    and ${or(canAccessProject('_pv.project_id'), participantCanSeePieces('_pv.project_id'))})`,
);

// Editing a piece's content (details, files, bar markers).
export const canEditPiece = (pieceId: string) => or(
  hasFullPieceAccess(),
  `${hasProjectPieceAccess()} and exists (
    select 1 from project_pieces _pe where _pe.piece_id = ${pieceId} and ${canAccessProject('_pe.project_id')}
  )`,
);

export const canAccessClub = () =>
  `exists (select 1 from app_users _u where _u.id = auth_uid() and (_u.is_admin or _u.can_access_club))`;

const eventInManagedProject = (eventId: string) =>
  `exists (select 1 from events _e where _e.id = ${eventId} and ${canAccessProject('_e.project_id')})`;

const pageInManagedProject = (pageId: string) =>
  `exists (select 1 from registration_pages _rp where _rp.id = ${pageId} and ${canAccessProject('_rp.project_id')})`;

// Same predicate for every operation (Postgres "for all ... using/with check").
const all = (p: Predicate): TablePolicy => ({ select: p, insert: p, update: p, check: p, delete: p });

// Only web links (no javascript: or data: URLs) for calendar events.
const validateCalendarLink = (value: unknown) => {
  if (value === undefined || value === null || value === '') return;
  if (typeof value !== 'string' || value.length > 2000 || !/^https?:\/\/\S+$/i.test(value)) {
    throw new ApiError('Links must start with http:// or https://', 400, '23514');
  }
};

// A registration deadline must be a full ISO timestamp with time zone (or
// null). The public RPCs treat anything unparsable as closed.
const validateClosesAt = (row: Record<string, unknown>) => {
  const value = row.closes_at;
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ApiError('Invalid registration deadline', 400);
  }
};

// A registration cover must be a file uploaded to this app, never an external
// URL (which would let visitors of the public page be tracked).
const validateCoverUrl = (row: Record<string, unknown>) => {
  const value = row.cover_url;
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || !/^\/files\/photos\/[A-Za-z0-9._\/-]+$/.test(value) || value.includes('..')) {
    throw new ApiError('Invalid cover image', 400);
  }
};

// Custom header of a public registration form: one short line of plain text.
const validateHeaderText = (row: Record<string, unknown>) => {
  const value = row.header_text;
  if (value === undefined || value === null) return;
  // eslint-disable-next-line no-control-regex
  if (typeof value !== 'string' || value.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ApiError('Invalid header text', 400);
  }
};

// Label of a registration page's extra (non-transferred) field: one short line.
const validateNoteLabel = (row: Record<string, unknown>) => {
  const value = row.note_label;
  if (value === undefined || value === null) return;
  // eslint-disable-next-line no-control-regex
  if (typeof value !== 'string' || value.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ApiError('Invalid note label', 400);
  }
};

// Background tint of a public registration form: a plain #rrggbb color.
const validateTintColor = (row: Record<string, unknown>) => {
  const value = row.tint_color;
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new ApiError('Invalid tint color', 400);
  }
};

// Absolute http(s) URL, as shown to the public (no javascript:, data:, ...).
const isHttpUrl = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname);
  } catch {
    return false;
  }
};

// Branding: a short plain-text name, a #rrggbb accent, an uploaded logo.
const validateBranding = (row: Record<string, unknown>) => {
  const name = row.brand_name;
  // eslint-disable-next-line no-control-regex
  if (name != null && (typeof name !== 'string' || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name))) {
    throw new ApiError('Invalid app name', 400);
  }
  const accent = row.brand_accent;
  if (accent != null && (typeof accent !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(accent))) {
    throw new ApiError('Invalid accent color', 400);
  }
  const logo = row.brand_logo_url;
  if (logo != null && (typeof logo !== 'string' || !/^\/files\/photos\/[A-Za-z0-9._\/-]+$/.test(logo) || logo.includes('..'))) {
    throw new ApiError('Invalid logo', 400);
  }
};

// --- policies ---------------------------------------------------------------

// A manual event's last day and repeat end can't lie before its first day.
const validateCalendarDates = (row: Record<string, unknown>) => {
  for (const field of ['end_date', 'repeat_until']) {
    const value = row[field];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < String(row.date ?? '')) {
      throw new ApiError('End dates must not lie before the start date', 400, '23514');
    }
  }
};

const PROTECTED_ACCOUNT_FIELDS = [
  'id',
  'email',
  'is_admin',
  'can_manage_projects',
  'can_access_club',
  'piece_access',
  'approved', // accounts waiting for approval can't approve themselves
] as const;

// Bar-marker editing lock on a piece (see migration 0027): held by someone
// else while their heartbeat is fresh.
export const MARKERS_LOCK_TTL_MS = 60_000;
export const markersLockedByOther = (row: Record<string, unknown>, uid: string) =>
  row.markers_locked_by != null &&
  row.markers_locked_by !== uid &&
  Date.parse(String(row.markers_locked_at ?? '')) > Date.now() - MARKERS_LOCK_TTL_MS;

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
      // Only the account holder sets their profile photo.
      if ('photo_url' in patch && !self && normalize(patch.photo_url) !== normalize(oldRow.photo_url)) {
        throw new ApiError('Only the account holder can change the profile photo', 403, '42501');
      }
    },
  },

  app_settings: {
    select: () => 'true',
    insert: isAdmin,
    update: isAdmin,
    check: isAdmin,
    delete: isAdmin,
    validateUpdate: (oldRow, patch, { uid }) => {
      // Turning on required 2FA needs it on the admin's own account first, or
      // they'd lock themselves out.
      if (patch.require_admin_2fa && !oldRow.require_admin_2fa) {
        if (!hasSecondFactor(uid)) {
          throw new ApiError('Enable two-factor authentication on your own account first', 400, 'mfa_self_required');
        }
      }
      if ('session_days' in patch && patch.session_days !== null) {
        const days = Number(patch.session_days);
        if (!Number.isInteger(days) || days < MIN_SESSION_DAYS || days > MAX_SESSION_DAYS) {
          throw new ApiError(`Session length must be ${MIN_SESSION_DAYS}–${MAX_SESSION_DAYS} days`, 400);
        }
      }
      validateBranding(patch);
      // Legal pages (imprint, privacy policy): bounded text, http(s) links only.
      for (const kind of ['imprint', 'privacy']) {
        const text = patch[`${kind}_text`];
        if (text !== undefined && (typeof text !== 'string' || text.length > 100_000)) {
          throw new ApiError('Text is too long', 400);
        }
        const url = patch[`${kind}_url`];
        if (url !== undefined && url !== null && !isHttpUrl(url)) {
          throw new ApiError('Link must be an http(s) URL', 400, 'invalid_legal_url');
        }
      }
    },
  },

  // Project settings, archiving and deletion need access to all projects;
  // an individual grant only covers the project's content.
  projects: {
    select: (a) => or(canAccessProject(`${a}.id`), isProjectParticipant(`${a}.id`)),
    insert: canManageProjects,
    update: canManageProjects,
    check: () => 'true',
    delete: canManageProjects,
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
    // The photo mirrors the linked account's (database triggers); nobody sets it here.
    validateUpdate: (oldRow, patch) => {
      if ('photo_url' in patch && normalize(patch.photo_url) !== normalize(oldRow.photo_url)) {
        throw new ApiError('Member photos come from the linked account', 403, '42501');
      }
    },
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

  // Kalender (dashboard tab): admins only.
  calendars: all(isAdmin),
  calendar_projects: all(isAdmin),
  calendar_events: {
    ...all(isAdmin),
    // The link is rendered as <a href> and put into the iCal feed.
    validateInsert: (row) => {
      validateCalendarLink(row.link);
      validateCalendarDates(row);
    },
    validateUpdate: (old, patch) => {
      if ('link' in patch) validateCalendarLink(patch.link);
      validateCalendarDates({ ...old, ...patch });
    },
  },
  // Single occurrences of repeating manual events (see migration 0037).
  calendar_event_exceptions: {
    ...all(isAdmin),
    validateInsert: (row) => {
      validateCalendarLink(row.link);
      validateCalendarDates(row);
    },
    validateUpdate: (old, patch) => {
      if ('link' in patch) validateCalendarLink(patch.link);
      validateCalendarDates({ ...old, ...patch });
    },
  },
  // Subscription links (token = credential, see migration 0037).
  calendar_links: {
    ...all(isAdmin),
    validateInsert: (row) => {
      if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 80) {
        throw new ApiError('Invalid link name', 400, '23514');
      }
    },
  },

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

  registration_pages: {
    ...all((a) => canAccessProject(`${a}.project_id`)),
    validateInsert: (row) => {
      validateClosesAt(row);
      validateCoverUrl(row);
      validateHeaderText(row);
      validateTintColor(row);
      validateNoteLabel(row);
    },
    validateUpdate: (_oldRow, patch) => {
      validateClosesAt(patch);
      validateCoverUrl(patch);
      validateHeaderText(patch);
      validateTintColor(patch);
      validateNoteLabel(patch);
    },
  },

  registrations: all((a) => pageInManagedProject(`${a}.registration_page_id`)),

  club_members: all(() => canAccessClub()),

  // New pieces in a project are created through create_piece (piece and
  // project link at once); here only with full access.
  pieces: {
    select: (a) => canSeePiece(`${a}.id`),
    insert: hasFullPieceAccess,
    update: (a) => canEditPiece(`${a}.id`),
    check: (a) => canEditPiece(`${a}.id`),
    delete: hasFullPieceAccess,
    validateUpdate: (oldRow, patch, { uid }) => {
      // The archive belongs to the collection page.
      if (
        'archived' in patch &&
        normalize(patch.archived) !== normalize(oldRow.archived) &&
        !(db.prepare(`select ${hasFullPieceAccess()} as v`).get() as { v: number }).v
      ) {
        throw new ApiError('Archiving pieces needs access to all pieces', 403, '42501');
      }
      // The lock is taken and released through its RPCs only.
      if (['markers_locked_by', 'markers_locked_name', 'markers_locked_at'].some((k) => k in patch)) {
        throw new ApiError('The marker lock is managed by the server', 403, '42501');
      }
      if ('bar_anchors' in patch && markersLockedByOther(oldRow, uid)) {
        throw new ApiError(`${String(oldRow.markers_locked_name ?? '')} is editing the bars`, 409, 'P0001');
      }
      if (
        'midi_credit_photo_url' in patch &&
        normalize(patch.midi_credit_photo_url) !== normalize(oldRow.midi_credit_photo_url)
      ) {
        throw new ApiError('The credit photo comes from the linked account', 403, '42501');
      }
    },
  },

  piece_files: {
    ...all((a) => canEditPiece(`${a}.piece_id`)),
    select: (a) => canSeePiece(`${a}.piece_id`),
  },

  // A piece's voices (pointing at its recordings) and its credits.
  piece_tracks: {
    ...all((a) => canEditPiece(`${a}.piece_id`)),
    select: (a) => canSeePiece(`${a}.piece_id`),
  },

  piece_credits: {
    ...all((a) => canEditPiece(`${a}.piece_id`)),
    select: (a) => canSeePiece(`${a}.piece_id`),
    // The photo mirrors the linked account's (database triggers).
    validateInsert: (row) => {
      if (row.photo_url != null) throw new ApiError('Credit photos come from the linked account', 403, '42501');
    },
    validateUpdate: (oldRow, patch) => {
      if ('photo_url' in patch && normalize(patch.photo_url) !== normalize(oldRow.photo_url)) {
        throw new ApiError('Credit photos come from the linked account', 403, '42501');
      }
    },
  },

  // A project's pieces and their running order: managed by the project's
  // managers. Archived pieces can't be added.
  project_pieces: {
    ...all((a) => canAccessProject(`${a}.project_id`)),
    select: (a) => or(canAccessProject(`${a}.project_id`), participantCanSeePieces(`${a}.project_id`)),
    insert: (a) =>
      `${canAccessProject(`${a}.project_id`)} and exists (
        select 1 from pieces _pa where _pa.id = ${a}.piece_id and not _pa.archived
      )`,
    validateUpdate: (oldRow, patch) => {
      for (const field of ['project_id', 'piece_id'] as const) {
        if (field in patch && patch[field] !== oldRow[field]) {
          throw new ApiError('A project piece is only reordered, not moved', 403, '42501');
        }
      }
    },
  },

  // A rehearsal's programme. Managers edit it; participants read it on "Meine
  // Teilnahme" when the project shows them its pieces. Only pieces already in
  // the event's project can be assigned.
  event_pieces: {
    ...all((a) => `exists (
      select 1 from events _e join project_pieces _pp on _pp.project_id = _e.project_id
      where _e.id = ${a}.event_id and _pp.piece_id = ${a}.piece_id and ${canAccessProject('_e.project_id')}
    )`),
    select: (a) => `exists (
      select 1 from events _e where _e.id = ${a}.event_id
        and (${canAccessProject('_e.project_id')} or ${participantCanSeePieces('_e.project_id')})
    )`,
  },

  absence_labels: {
    ...all((a) => canAccessProject(`${a}.project_id`)),
    select: (a) =>
      or(
        canAccessProject(`${a}.project_id`),
        // The audition rule is always shown to participants.
        `(${a}.is_public or ${a}.kind = 'audition') and ${isProjectParticipant(`${a}.project_id`)}`,
      ),
  },
};

const normalize = (v: unknown) => (typeof v === 'boolean' ? (v ? 1 : 0) : v ?? null);
