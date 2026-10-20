// What a project's navigation shows the caller: which of the newer areas
// exist for them, and the quiet counts on their entries. Managers see every
// area anyway; participants only what is published for them.
import { db, authUid, ApiError } from './db.ts';
import { canAccessProject, isProjectParticipant } from './policies.ts';
import { openFormsFor } from './forms.ts';
import { missingRoomsFor, weekendNav } from './weekends.ts';

type Args = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));

const holds = (sql: string, params: Record<string, unknown>) =>
  Boolean((db.prepare(`select (${sql}) as v`).get(params) as { v: number }).v);

const project_nav = (args: Args) => {
  if (!authUid()) throw new ApiError('Authentication required', 401, '42501');
  const pid = text(args.p_project_id);
  const manager = holds(canAccessProject('@pid'), { pid });
  const participant = holds(isProjectParticipant('@pid'), { pid });
  const exists = (sql: string) => Boolean(db.prepare(sql).get(pid));
  const uid = authUid()!;
  return {
    manager,
    // At least one published concert.
    concerts:
      manager ||
      (participant && exists(`select 1 from concerts where project_id = ? and status = 'published' and not archived limit 1`)),
    // At least one published, listed survey (link-only ones never count).
    surveys:
      manager ||
      (participant &&
        exists(
          `select 1 from forms where project_id = ? and listed and status <> 'draft' and not archived
             and version_id is not null limit 1`,
        )),
    // One's own surveys still to answer.
    open_surveys: participant ? openFormsFor(uid, pid).filter((f) => f.my !== 'answered').length : 0,
    // The rehearsal weekend area, and a missing room choice.
    ...weekendNav(pid, uid, manager, participant),
  };
};

// The account's own to-dos across its projects (dashboard): open listed
// surveys with its state, and weekends where it still has to pick a room.
// Metadata only, never anyone's answers.
const my_tasks = () => {
  const uid = authUid();
  if (!uid) throw new ApiError('Authentication required', 401, '42501');
  return { surveys: openFormsFor(uid), rooms: missingRoomsFor(uid) };
};

export const projectNavFunctions = { project_nav, my_tasks };
