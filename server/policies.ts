// Row-level access control, ported from the former Postgres RLS policies.
//
// Every policy is a SQL predicate over a table alias. The data API applies:
//   select → rows must satisfy `select`
//   update → target rows must satisfy `update`, changed rows must satisfy `check`
//   delete → target rows must satisfy `delete`
//   insert → new rows must satisfy `insert`
// A missing predicate denies the operation. auth_uid() is the calling user.
import fs from 'node:fs';
import path from 'node:path';
import { ApiError, authUid, db, nowIso } from './db.ts';
import { env } from './env.ts';
import { MAX_SESSION_DAYS, MIN_SESSION_DAYS } from './settings.ts';
import { hasSecondFactor } from './mfa.ts';
import { isLanguage } from '../shared/languages.ts';
import { CONTACT_LABEL_MAX, CONTACT_VALUE_MAX, isContactKind } from '../shared/contactKinds.ts';

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

// --- roles (see migration 0044) -------------------------------------------
//   participant  (Teilnehmer)  only what isProjectParticipant() opens
//   section_lead (Stimmeltern) the content of every project
//   manager      (Verwaltung)  everything except the admin configuration
//   music_director (Musikalische Leitung, migration 0067) every project's
//                              content and every piece, but never a project
//                              member (no joining, no attendance) and no
//                              project settings
//   admin                      everything
export const ROLES = ['participant', 'section_lead', 'manager', 'music_director', 'admin'] as const;
export type Role = (typeof ROLES)[number];

// The calling account holds `role` or a higher one.
const hasRole = (role: Role) => {
  const allowed = ROLES.slice(ROLES.indexOf(role)).map((r) => `'${r}'`).join(', ');
  return `exists (select 1 from app_users _u where _u.id = auth_uid() and _u.role in (${allowed}))`;
};

export const isAdmin = () => hasRole('admin');

// Creating projects, their settings, archiving and deletion: Verwaltung and
// admins (not the music director).
export const canManageProjects = () =>
  `exists (select 1 from app_users _u where _u.id = auth_uid() and _u.role in ('manager', 'admin'))`;

// The content of a project (members, Proben, attendance, registrations,
// labels, its pieces): Stimmeltern and up, for every project.
export const canAccessProject = (_pid: string) => hasRole('section_lead');

// Pages that work across projects (e.g. looking up accounts to add as members).
export const canManageAnyProject = () => hasRole('section_lead');

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

// Edits every piece, opens the collection page, archives and deletes pieces:
// Verwaltung.
export const hasFullPieceAccess = () => hasRole('manager');

// Reading a piece: full access, or the piece is in a project one manages or
// takes part in (while that project shows its pieces to participants).
export const canSeePiece = (pieceId: string) => or(
  hasFullPieceAccess(),
  `exists (select 1 from project_pieces _pv where _pv.piece_id = ${pieceId}
    and ${or(canAccessProject('_pv.project_id'), participantCanSeePieces('_pv.project_id'))})`,
);

// Editing a piece's content (details, files, bar markers): Verwaltung, or
// Stimmeltern for pieces that are in a project.
export const canEditPiece = (pieceId: string) => or(
  hasFullPieceAccess(),
  `exists (
    select 1 from project_pieces _pe where _pe.piece_id = ${pieceId} and ${canAccessProject('_pe.project_id')}
  )`,
);

// --- a piece's files: public / private (see migrations 0060 and 0063) ------

// A folder is public when it and every folder above it are.
export const folderIsPublic = (folderId: string) => `not exists (
  with recursive _up (id) as (
    select ${folderId}
    union select _d.parent_id from _up join piece_file_folders _d on _d.id = _up.id where _d.parent_id is not null
  ) select 1 from _up join piece_file_folders _d on _d.id = _up.id where not _d.downloadable
)`;

// A file is public when it is and its folders are.
export const fileIsPublic = (a: string) => `(${a}.downloadable and (${a}.folder_id is null or ${folderIsPublic(`${a}.folder_id`)}))`;

// What the piece itself shows or plays: its score (the picked one, else its
// first), notation, bar timing, trainer file and its voices' recordings.
// Members need those even when they are private on the "Dateien" page.
export const fileIsUsed = (a: string) => or(
  `exists (select 1 from pieces _pc where _pc.id = ${a}.piece_id
    and ${a}.id in (_pc.score_file_id, _pc.notation_file_id, _pc.timing_file_id, _pc.trainer_file_id))`,
  `exists (select 1 from piece_tracks _ut where _ut.piece_id = ${a}.piece_id
    and ${a}.id in (_ut.file_id, _ut.click_file_id, _ut.quiet_file_id, _ut.quiet_click_file_id))`,
  `${a}.kind = 'score' and ${a}.file_path is not null
    and not exists (select 1 from pieces _us join piece_files _sf on _sf.id = _us.score_file_id
      where _us.id = ${a}.piece_id and _sf.file_path is not null)
    and ${a}.id = (select _ff.id from piece_files _ff where _ff.piece_id = ${a}.piece_id
      and _ff.kind = 'score' and _ff.file_path is not null order by _ff.position, _ff.created_at limit 1)`,
);

// Who may read a file row (and its stored object): the piece's editors, and
// whoever can see the piece for public and used files.
export const canReadPieceFile = (a: string) => or(
  canEditPiece(`${a}.piece_id`),
  `${canSeePiece(`${a}.piece_id`)} and ${or(fileIsPublic(a), fileIsUsed(a))}`,
);

// Kalender page: Verwaltung.
export const canEditCalendars = () => hasRole('manager');

const eventInManagedProject = (eventId: string) =>
  `exists (select 1 from events _e where _e.id = ${eventId} and ${canAccessProject('_e.project_id')})`;

const groupInManagedProject = (groupId: string) =>
  `exists (select 1 from project_groups _g where _g.id = ${groupId} and ${canAccessProject('_g.project_id')})`;

// Rehearsal weekends (migration 0071).
export const weekendInManagedProject = (weekendId: string) =>
  `exists (select 1 from weekends _w where _w.id = ${weekendId} and ${canAccessProject('_w.project_id')})`;

// A confirmed participant of the weekend, by account — set directly or
// through the linked member row.
export const isConfirmedWeekendParticipant = (weekendId: string) => `exists (
  select 1 from weekend_participants _wp left join members _wm on _wm.id = _wp.member_id
  where _wp.weekend_id = ${weekendId} and _wp.kind in ('member', 'guest')
    and (_wp.user_id = auth_uid() or _wm.user_id = auth_uid())
)`;

// Published (or closed) and not archived: what participants may see.
export const weekendShown = (a: string) => `(${a}.status in ('published', 'closed') and not ${a}.archived)`;

export const formInManagedProject = (formId: string) =>
  `exists (select 1 from forms _f where _f.id = ${formId} and ${canAccessProject('_f.project_id')})`;

// Concerts: managed with the project's content; participants of the project
// see published ones that aren't archived (see migration 0069).
export const concertInManagedProject = (concertId: string) =>
  `exists (select 1 from concerts _c where _c.id = ${concertId} and ${canAccessProject('_c.project_id')})`;

export const concertVisible = (concertId: string) => `exists (
  select 1 from concerts _c where _c.id = ${concertId}
    and ${or(
      canAccessProject('_c.project_id'),
      `_c.status = 'published' and not _c.archived and ${isProjectParticipant('_c.project_id')}`,
    )}
)`;

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

// Project info box: bounded Markdown text and a short list of labelled
// http(s) links (rendered as <a href> to participants).
const validateProjectInfo = (row: Record<string, unknown>) => {
  if (row.text !== undefined && (typeof row.text !== 'string' || row.text.length > 20_000)) {
    throw new ApiError('Text is too long', 400, '23514');
  }
  if (row.links === undefined) return;
  const links = row.links;
  if (!Array.isArray(links) || links.length > 30) throw new ApiError('Invalid links', 400, '23514');
  for (const link of links) {
    const { label, url } = (link ?? {}) as Record<string, unknown>;
    if (typeof label !== 'string' || label.length > 200 || !isHttpUrl(url)) {
      throw new ApiError('Link must be an http(s) URL', 400, '23514');
    }
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
  'role',
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
        // An admin can't demote themselves (and lock everyone out).
        if (self && field === 'role') {
          throw new ApiError('You cannot change your own role', 403, '42501');
        }
      }
      // Only the account holder sets their profile photo.
      if ('photo_url' in patch && !self && normalize(patch.photo_url) !== normalize(oldRow.photo_url)) {
        throw new ApiError('Only the account holder can change the profile photo', 403, '42501');
      }
      // One of shared/languages.ts, or null for the instance default.
      if ('language' in patch && patch.language !== null && !isLanguage(patch.language)) {
        throw new ApiError('Unknown language', 400, '23514');
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

  // Project settings, archiving and deletion need Verwaltung; Stimmeltern
  // only work with a project's content.
  projects: {
    select: (a) =>
      or(
        canAccessProject(`${a}.id`),
        isProjectParticipant(`${a}.id`),
        // Confirmed for one of its published rehearsal weekends.
        `exists (select 1 from weekends _pw where _pw.project_id = ${a}.id and ${weekendShown('_pw')}
           and ${isConfirmedWeekendParticipant('_pw.id')})`,
      ),
    insert: canManageProjects,
    update: canManageProjects,
    check: () => 'true',
    delete: canManageProjects,
  },

  // The info box on "Meine Teilnahme": edited by Stimmeltern and up, read by
  // the project's participants.
  project_infos: {
    ...all((a) => canAccessProject(`${a}.project_id`)),
    select: (a) => or(canAccessProject(`${a}.project_id`), isProjectParticipant(`${a}.project_id`)),
    validateInsert: (row) => validateProjectInfo(row),
    validateUpdate: (_old, patch) => validateProjectInfo(patch),
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

  // Kalender (dashboard tab): admins and accounts with the calendar permission.
  calendars: all(canEditCalendars),
  calendar_projects: all(canEditCalendars),
  calendar_events: {
    ...all(canEditCalendars),
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
    ...all(canEditCalendars),
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
    ...all(canEditCalendars),
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

  // Editors see all of a piece's files; others only public ones and those
  // the piece itself uses (see canReadPieceFile).
  piece_files: {
    ...all((a) => canEditPiece(`${a}.piece_id`)),
    select: (a) => canReadPieceFile(a),
    // Server-made fields: a link's preview (server/linkFetch.ts), the size
    // and uploader (set here from the stored object and the caller) and the
    // maintenance job's findings.
    validateInsert: (row) => {
      if (row.link_preview != null) throw new ApiError('Link previews are made by the server', 403, '42501');
      validateFolderOfPiece(row.folder_id, row.piece_id);
      validateStoredKey(row.file_path, row.piece_id);
      const uid = authUid();
      const user = uid
        ? (db.prepare('select name from app_users where id = ?').get(uid) as { name: string } | undefined)
        : undefined;
      Object.assign(row, {
        size: storedSize(row.file_path),
        uploaded_by: uid,
        uploaded_by_name: user?.name ?? '',
        replaced_at: null,
        file_missing: false,
      });
    },
    validateUpdate: (oldRow, patch) => {
      if ('link_preview' in patch && JSON.stringify(patch.link_preview ?? null) !== JSON.stringify(oldRow.link_preview ?? null)) {
        throw new ApiError('Link previews are made by the server', 403, '42501');
      }
      if ('piece_id' in patch && patch.piece_id !== oldRow.piece_id) {
        throw new ApiError('A file stays with its piece', 400, '23514');
      }
      for (const key of ['size', 'uploaded_by', 'uploaded_by_name', 'replaced_at', 'file_missing']) {
        if (key in patch && normalize(patch[key]) !== normalize(oldRow[key])) {
          throw new ApiError(`${key} is set by the server`, 403, '42501');
        }
      }
      if ('folder_id' in patch) validateFolderOfPiece(patch.folder_id, oldRow.piece_id);
      // A new stored object (the file replaced): its size, and when.
      if ('file_path' in patch && patch.file_path !== oldRow.file_path) {
        validateStoredKey(patch.file_path, oldRow.piece_id);
        Object.assign(patch, { size: storedSize(patch.file_path), replaced_at: nowIso(), file_missing: false });
      }
    },
  },

  // Folders grouping a piece's files on its "Dateien" page: a tree within
  // the piece (see migration 0062). Others than editors see public ones.
  piece_file_folders: {
    ...all((a) => canEditPiece(`${a}.piece_id`)),
    select: (a) => or(canEditPiece(`${a}.piece_id`), `${canSeePiece(`${a}.piece_id`)} and ${folderIsPublic(`${a}.id`)}`),
    validateInsert: (row) => validateFolderOfPiece(row.parent_id, row.piece_id),
    validateUpdate: (oldRow, patch) => {
      if ('piece_id' in patch && patch.piece_id !== oldRow.piece_id) {
        throw new ApiError('A folder stays with its piece', 400, '23514');
      }
      if (!('parent_id' in patch) || patch.parent_id == null) return;
      validateFolderOfPiece(patch.parent_id, oldRow.piece_id);
      if (folderWithin(String(patch.parent_id), String(oldRow.id))) {
        throw new ApiError('A folder cannot move into itself', 400, '23514');
      }
    },
  },

  // Deleted files of a piece, for its editors (written by the trash RPCs).
  piece_file_trash: {
    select: (a) => canEditPiece(`${a}.piece_id`),
  },

  // Which trainer voices a project's groups sing: set by the piece's editors
  // within a project they manage; read by whoever can see the piece there.
  piece_trainer_voices: {
    ...all((a) => `${canEditPiece(`${a}.piece_id`)} and exists (
      select 1 from project_groups _tg where _tg.id = ${a}.group_id and ${canAccessProject('_tg.project_id')}
    )`),
    select: (a) => `${canSeePiece(`${a}.piece_id`)} and exists (
      select 1 from project_groups _tg where _tg.id = ${a}.group_id
        and ${or(canAccessProject('_tg.project_id'), isProjectParticipant('_tg.project_id'))}
    )`,
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

  // The singing trainer's history and preferences: each account's own, for
  // pieces it can open. Runs are only added (and go with the piece).
  practice_sessions: {
    select: (a) => `${a}.user_id = auth_uid()`,
    insert: (a) => `${a}.user_id = auth_uid() and ${canSeePiece(`${a}.piece_id`)}`,
  },

  // An account's own contact details (profile settings): written by the
  // account only, seen by it and by those who manage projects.
  account_contacts: {
    select: (a) => or(`${a}.user_id = auth_uid()`, canManageAnyProject()),
    insert: (a) => `${a}.user_id = auth_uid()`,
    update: (a) => `${a}.user_id = auth_uid()`,
    check: (a) => `${a}.user_id = auth_uid()`,
    delete: (a) => `${a}.user_id = auth_uid()`,
    validateInsert: (row) => validateContact(row, true),
    validateUpdate: (_oldRow, patch) => validateContact(patch, false),
  },

  practice_prefs: {
    ...all((a) => `${a}.user_id = auth_uid()`),
    insert: (a) => `${a}.user_id = auth_uid() and ${canSeePiece(`${a}.piece_id`)}`,
    validateUpdate: (oldRow, patch) => {
      for (const field of ['user_id', 'piece_id'] as const) {
        if (field in patch && patch[field] !== oldRow[field]) {
          throw new ApiError('Practice preferences stay with their piece', 403, '42501');
        }
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

  // Who looks after a group, and an internal note on it (migration 0068):
  // only for those who manage the project, never for participants. Being
  // named here grants nothing.
  group_responsibles: {
    ...all((a) => groupInManagedProject(`${a}.group_id`)),
    validateUpdate: (oldRow, patch) => {
      for (const field of ['group_id', 'user_id'] as const) {
        if (field in patch && patch[field] !== oldRow[field]) {
          throw new ApiError('A responsibility is only reordered, not moved', 403, '42501');
        }
      }
    },
  },
  group_notes: {
    ...all((a) => groupInManagedProject(`${a}.group_id`)),
    validateInsert: (row) => validateGroupNote(row),
    validateUpdate: (oldRow, patch) => {
      if ('group_id' in patch && patch.group_id !== oldRow.group_id) {
        throw new ApiError('A note stays with its group', 403, '42501');
      }
      validateGroupNote(patch);
    },
  },

  concerts: {
    ...all((a) => canAccessProject(`${a}.project_id`)),
    select: (a) =>
      or(
        canAccessProject(`${a}.project_id`),
        `${a}.status = 'published' and not ${a}.archived and ${isProjectParticipant(`${a}.project_id`)}`,
      ),
    validateInsert: (row) => validateConcert(row, true),
    validateUpdate: (oldRow, patch) => {
      if ('project_id' in patch && patch.project_id !== oldRow.project_id) {
        throw new ApiError('A concert stays with its project', 403, '42501');
      }
      validateConcert(patch, false);
    },
  },
  concert_program_items: {
    ...all((a) => concertInManagedProject(`${a}.concert_id`)),
    select: (a) => concertVisible(`${a}.concert_id`),
    validateInsert: (row) => validateProgramItem(row, String(row.concert_id ?? '')),
    validateUpdate: (oldRow, patch) => {
      if ('concert_id' in patch && patch.concert_id !== oldRow.concert_id) {
        throw new ApiError('A programme item stays with its concert', 403, '42501');
      }
      validateProgramItem(patch, String(oldRow.concert_id));
    },
  },
  // Recordings are written here (the stored object is uploaded first); a
  // deletion goes through the trash functions in server/concerts.ts.
  concert_recordings: {
    select: (a) => concertVisible(`${a}.concert_id`),
    insert: (a) => concertInManagedProject(`${a}.concert_id`),
    update: (a) => concertInManagedProject(`${a}.concert_id`),
    check: (a) => concertInManagedProject(`${a}.concert_id`),
    validateInsert: (row) => {
      validateRecording(row, String(row.concert_id ?? ''), true);
      const uid = authUid();
      const user = uid
        ? (db.prepare('select name from app_users where id = ?').get(uid) as { name: string } | undefined)
        : undefined;
      Object.assign(row, {
        size: row.kind === 'file' ? storedObjectSize('concert-files', row.file_path) : null,
        file_missing: false,
        uploaded_by_name: user?.name ?? '',
      });
    },
    validateUpdate: (oldRow, patch) => {
      for (const field of ['concert_id', 'kind', 'file_path', 'size', 'file_missing', 'uploaded_by_name'] as const) {
        if (field in patch && normalize(patch[field]) !== normalize(oldRow[field])) {
          throw new ApiError(`${field} can't be changed`, 403, '42501');
        }
      }
      validateRecording(patch, String(oldRow.concert_id), false);
    },
  },
  concert_recording_trash: {
    select: (a) => concertInManagedProject(`${a}.concert_id`),
  },

  // Rehearsal weekends (migration 0071): managed with the project's
  // content; its participants see published ones (and their rooms once
  // confirmed — through server/weekends.ts, which also handles imports and
  // room choices).
  weekends: {
    ...all((a) => canAccessProject(`${a}.project_id`)),
    select: (a) =>
      or(
        canAccessProject(`${a}.project_id`),
        `${weekendShown(a)} and ${or(isProjectParticipant(`${a}.project_id`), isConfirmedWeekendParticipant(`${a}.id`))}`,
      ),
    validateInsert: (row) => validateWeekend(row, true),
    validateUpdate: (oldRow, patch) => {
      if ('project_id' in patch && patch.project_id !== oldRow.project_id) {
        throw new ApiError('A weekend stays with its project', 403, '42501');
      }
      validateWeekend({ ...oldRow, ...patch }, false);
    },
  },
  weekend_rooms: {
    ...all((a) => weekendInManagedProject(`${a}.weekend_id`)),
    select: (a) => or(weekendInManagedProject(`${a}.weekend_id`), isConfirmedWeekendParticipant(`${a}.weekend_id`)),
    // An occupied room is never deleted by the way.
    delete: (a) =>
      `${weekendInManagedProject(`${a}.weekend_id`)} and not exists (
        select 1 from weekend_room_assignments _ra where _ra.room_id = ${a}.id)`,
    validateInsert: (row) => validateRoom(row, null),
    validateUpdate: (oldRow, patch) => {
      if ('weekend_id' in patch && patch.weekend_id !== oldRow.weekend_id) {
        throw new ApiError('A room stays with its weekend', 403, '42501');
      }
      validateRoom(patch, String(oldRow.id));
    },
  },
  // The list itself is the managers'; entries come from the import and the
  // functions in server/weekends.ts. A change by hand marks the entry.
  weekend_participants: {
    select: (a) => weekendInManagedProject(`${a}.weekend_id`),
    update: (a) => weekendInManagedProject(`${a}.weekend_id`),
    check: (a) => weekendInManagedProject(`${a}.weekend_id`),
    delete: (a) => weekendInManagedProject(`${a}.weekend_id`),
    validateUpdate: (oldRow, patch) => {
      for (const field of ['weekend_id', 'kind', 'member_id', 'user_id', 'import_id'] as const) {
        if (field in patch && normalize(patch[field]) !== normalize(oldRow[field])) {
          throw new ApiError(`${field} is changed through the weekend functions`, 403, '42501');
        }
      }
      checkText(patch, 'name', 200);
      Object.assign(patch, { changed_by_hand: true, updated_at: nowIso() });
    },
  },
  weekend_imports: {
    select: (a) => weekendInManagedProject(`${a}.weekend_id`),
  },
  weekend_room_assignments: {
    select: (a) => `exists (select 1 from weekend_rooms _r where _r.id = ${a}.room_id and ${weekendInManagedProject('_r.weekend_id')})`,
  },

  // A project being set up: its creator's alone (migration 0072).
  onboarding_drafts: {
    ...all((a) => `${a}.user_id = auth_uid() and ${canManageProjects()}`),
    validateInsert: (row) => {
      if (JSON.stringify(row.data ?? {}).length > 2_000_000) throw new ApiError('The draft is too large', 413);
    },
    validateUpdate: (oldRow, patch) => {
      if ('user_id' in patch && patch.user_id !== oldRow.user_id) throw new ApiError('A draft stays with its account', 403, '42501');
      if (JSON.stringify(patch.data ?? {}).length > 2_000_000) throw new ApiError('The draft is too large', 413);
    },
  },

  // Surveys (migration 0070): managers read forms and change their settings
  // here; creating, the structure, publishing and every answer go through
  // server/forms.ts. Participants never read these tables directly.
  forms: {
    select: (a) => canAccessProject(`${a}.project_id`),
    update: (a) => canAccessProject(`${a}.project_id`),
    check: (a) => canAccessProject(`${a}.project_id`),
    delete: (a) => canAccessProject(`${a}.project_id`),
    validateUpdate: (oldRow, patch) => validateFormSettings(oldRow, patch),
  },
  form_versions: {
    select: (a) => formInManagedProject(`${a}.form_id`),
  },
  form_invites: {
    select: (a) => formInManagedProject(`${a}.form_id`),
    delete: (a) => formInManagedProject(`${a}.form_id`),
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

// Whether folder `folderId` is `ancestorId` or lies inside it.
export const folderWithin = (folderId: string, ancestorId: string) =>
  Boolean(
    (
      db
        .prepare(
          `with recursive up (id) as (
             select ? union select d.parent_id from up join piece_file_folders d on d.id = up.id where d.parent_id is not null
           ) select exists (select 1 from up where id = ?) as inside`,
        )
        .get(folderId, ancestorId) as { inside: number }
    ).inside,
  );

// Keys of the piece-files bucket as the app makes them: "<pieceId>/<name>",
// lower case, plain segments ("<uuid>.pdf", "preview-….jpg", "link-….jpg").
const CANONICAL_KEY = /^[a-z0-9][a-z0-9-]{0,63}\/[a-z0-9][a-z0-9._-]{0,199}$/;
export const isCanonicalKey = (key: unknown): key is string =>
  typeof key === 'string' && CANONICAL_KEY.test(key) && !key.includes('..');

// Where a piece-files key is stored, or null for anything that isn't a
// canonical key or would leave the bucket: no stored key, old or new, ever
// reaches the file system unchecked.
export const pieceObjectPath = (key: unknown): string | null => {
  if (!isCanonicalKey(key)) return null;
  const base = path.resolve(env.storageDir, 'piece-files');
  const full = path.resolve(base, key);
  return full.startsWith(base + path.sep) ? full : null;
};

// Stored objects of a piece live under "<pieceId>/": a row can't point at
// another piece's file (and so open it to that piece's readers).
const validateStoredKey = (key: unknown, pieceId: unknown) => {
  if (key == null) return;
  if (!isCanonicalKey(key) || !key.startsWith(`${String(pieceId)}/`)) {
    throw new ApiError('The file is not part of this piece', 400, '23514');
  }
};

// Size in bytes of a stored piece file, or null when there is none.
export const storedSize = (key: unknown): number | null => {
  const file = pieceObjectPath(key);
  if (!file) return null;
  try {
    return fs.statSync(file).size;
  } catch {
    return null;
  }
};

// A contact detail: a known kind, a value and a short optional label.
const validateContact = (row: Record<string, unknown>, complete: boolean) => {
  if ((complete || 'kind' in row) && !isContactKind(row.kind)) {
    throw new ApiError('Unknown kind of contact', 400, '23514');
  }
  if (complete || 'value' in row) {
    const value = typeof row.value === 'string' ? row.value.trim() : '';
    if (!value || value.length > CONTACT_VALUE_MAX) throw new ApiError('Invalid contact', 400, '23514');
  }
  if ('label' in row && row.label != null && (typeof row.label !== 'string' || row.label.length > CONTACT_LABEL_MAX)) {
    throw new ApiError('Invalid label', 400, '23514');
  }
};

// A file's folder or a folder's parent: none, or a folder of the same piece.
const validateFolderOfPiece = (folderId: unknown, pieceId: unknown) => {
  if (folderId == null) return;
  const found = db
    .prepare('select 1 from piece_file_folders where id = ? and piece_id = ?')
    .get(String(folderId), String(pieceId));
  if (!found) throw new ApiError('The folder is not part of this piece', 400, '23503');
};

// --- groups and concerts (migrations 0068, 0069) ----------------------------

const validateGroupNote = (row: Record<string, unknown>) => {
  if ('note' in row && (typeof row.note !== 'string' || row.note.length > 4000)) {
    throw new ApiError('The note is too long', 400, '23514');
  }
};

const checkText = (row: Record<string, unknown>, field: string, max: number, required = false) => {
  if (!(field in row)) {
    if (required) throw new ApiError(`${field} is required`, 400, '23514');
    return;
  }
  const value = row[field];
  if (value === null && !required) return;
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new ApiError(`Invalid ${field}`, 400, '23514');
  }
};

const validateConcert = (row: Record<string, unknown>, complete: boolean) => {
  checkText(row, 'title', 200, complete);
  if ('title' in row && !String(row.title ?? '').trim()) throw new ApiError('A concert needs a title', 400, '23514');
  checkText(row, 'location', 300);
  checkText(row, 'description', 20_000);
  checkText(row, 'dress_code', 5000);
};

// A piece in a concert's programme must be one of its project's pieces.
const validateProgramItem = (row: Record<string, unknown>, concertId: string) => {
  checkText(row, 'title', 300);
  checkText(row, 'note', 1000);
  if (row.piece_id == null) return;
  const inProject = db
    .prepare(
      `select 1 from concerts c join project_pieces pp on pp.project_id = c.project_id
       where c.id = ? and pp.piece_id = ?`,
    )
    .get(concertId, String(row.piece_id));
  if (!inProject) throw new ApiError('The piece is not part of this project', 400, '23503');
};

const validateRecording = (row: Record<string, unknown>, concertId: string, complete: boolean) => {
  checkText(row, 'title', 300);
  if (row.item_id != null) {
    const ofConcert = db
      .prepare('select 1 from concert_program_items where id = ? and concert_id = ?')
      .get(String(row.item_id), concertId);
    if (!ofConcert) throw new ApiError('The programme item is not part of this concert', 400, '23503');
  }
  if (complete && row.kind === 'file') {
    const key = row.file_path;
    if (!isCanonicalKey(key) || !key.startsWith(`${concertId}/`)) {
      throw new ApiError('The file is not part of this concert', 400, '23514');
    }
    if (row.url != null) throw new ApiError('A file has no link', 400, '23514');
  }
  if ((complete && row.kind === 'link') || ('url' in row && row.url != null)) {
    if (!isHttpUrl(row.url)) throw new ApiError('Link must be an http(s) URL', 400, '23514');
  }
};

// Where a key of one of the private buckets (concert-files, form-files) is
// stored, or null for anything that isn't a canonical key.
export const bucketObjectPath = (bucket: 'concert-files' | 'form-files', key: unknown): string | null => {
  if (!isCanonicalKey(key)) return null;
  const base = path.resolve(env.storageDir, bucket);
  const full = path.resolve(base, key);
  return full.startsWith(base + path.sep) ? full : null;
};

export const storedObjectSize = (bucket: 'concert-files' | 'form-files', key: unknown): number | null => {
  const file = bucketObjectPath(bucket, key);
  if (!file) return null;
  try {
    return fs.statSync(file).size;
  } catch {
    return null;
  }
};

// --- surveys (migration 0070) -----------------------------------------------

// Set by the server only: the link, the structure and its versions, the
// lifecycle (server/forms.ts) and the notification bookkeeping.
const FORM_SERVER_FIELDS = [
  'id',
  'project_id',
  'token',
  'draft',
  'draft_saved_at',
  'version_id',
  'status',
  'archived',
  'published_at',
  'created_by',
  'created_at',
  'notify_sent_at',
  'notify_sent_count',
] as const;

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const validateFormSettings = (oldRow: Record<string, unknown>, patch: Record<string, unknown>) => {
  for (const field of FORM_SERVER_FIELDS) {
    if (field in patch && normalize(patch[field]) !== normalize(oldRow[field])) {
      throw new ApiError(`${field} is set by the server`, 403, '42501');
    }
  }
  if ('title' in patch && (typeof patch.title !== 'string' || !patch.title.trim() || patch.title.length > 200)) {
    throw new ApiError('A form needs a title', 400, '23514');
  }
  // What respondents were promised about their identity holds for good.
  if ('identity' in patch && patch.identity !== oldRow.identity) {
    const answered = db.prepare('select 1 from form_responses where form_id = ? limit 1').get(String(oldRow.id));
    if (answered) throw new ApiError('The identity mode is fixed once there are responses', 409, 'identity_locked');
  }
  for (const field of ['opens_at', 'closes_at']) {
    const value = patch[field];
    if (value != null && (typeof value !== 'string' || !ISO_TIME.test(value) || Number.isNaN(Date.parse(value)))) {
      throw new ApiError('Invalid date', 400, '23514');
    }
  }
  const opens = 'opens_at' in patch ? patch.opens_at : oldRow.opens_at;
  const closes = 'closes_at' in patch ? patch.closes_at : oldRow.closes_at;
  if (typeof opens === 'string' && typeof closes === 'string' && Date.parse(closes) <= Date.parse(opens)) {
    throw new ApiError('The form must close after it opens', 400, 'closes_before_opens');
  }
  if ('consent_text' in patch && (typeof patch.consent_text !== 'string' || patch.consent_text.length > 5000)) {
    throw new ApiError('The consent text is too long', 400, '23514');
  }
  if ('notify_user_ids' in patch) {
    const ids = patch.notify_user_ids;
    if (!Array.isArray(ids) || ids.length > 30 || !ids.every((id) => typeof id === 'string' && id.length <= 64)) {
      throw new ApiError('Invalid recipients', 400, '23514');
    }
    // Only people who manage the project's content can be told.
    for (const id of ids) {
      const ok = db
        .prepare(`select 1 from app_users where id = ? and role in ('section_lead', 'manager', 'music_director', 'admin')`)
        .get(id);
      if (!ok) throw new ApiError('Only project managers can be notified', 400, '23514');
    }
  }
};

// --- rehearsal weekends (migration 0071) ------------------------------------

const validateWeekend = (row: Record<string, unknown>, complete: boolean) => {
  checkText(row, 'title', 200, complete);
  if ('title' in row && !String(row.title ?? '').trim()) throw new ApiError('A weekend needs a title', 400, '23514');
  checkText(row, 'location', 300);
  checkText(row, 'description', 20_000);
  if (row.signup_url != null && row.signup_url !== '' && !isHttpUrl(row.signup_url)) {
    throw new ApiError('Link must be an http(s) URL', 400, '23514');
  }
  if (row.signup_url === '') row.signup_url = null;
};

// Rooms: a name and a positive capacity, never below who already sleeps there.
const validateRoom = (row: Record<string, unknown>, roomId: string | null) => {
  checkText(row, 'name', 120, roomId === null);
  if ('name' in row && !String(row.name ?? '').trim()) throw new ApiError('A room needs a name', 400, '23514');
  checkText(row, 'description', 1000);
  if ('capacity' in row) {
    const capacity = Number(row.capacity);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) throw new ApiError('Invalid capacity', 400, '23514');
    if (roomId) {
      const { n } = db.prepare('select count(*) as n from weekend_room_assignments where room_id = ?').get(roomId) as { n: number };
      if (capacity < n) throw new ApiError('The room has more people than that', 409, 'room_overfull');
    }
  }
};
