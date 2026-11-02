// Recording that something happened, for the notification engine
// (notifications.ts) to turn into notifications. Kept apart from the engine
// so that auth.ts can use it without importing the engine's dependencies
// (forms.ts imports auth.ts).
import { db } from './db.ts';

let kick: () => void = () => undefined;

// The engine registers how to start a run soon.
export const onEnqueue = (fn: () => void) => {
  kick = fn;
};

export const enqueue = (kind: string, ref: string, data: Record<string, unknown> = {}, actorId: string | null = null) => {
  db.prepare('insert into notification_queue (kind, ref, actor_id, data) values (?, ?, ?, ?)').run(
    kind,
    ref,
    actorId,
    JSON.stringify(data),
  );
  kick();
};
