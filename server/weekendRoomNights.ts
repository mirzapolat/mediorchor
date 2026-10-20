// Who sleeps which nights in a rehearsal weekend's rooms (migration 0076) —
// for the room choice (server/weekends.ts) and the capacity check when a
// room is edited (server/policies.ts). Kept apart from both so neither
// imports the other.
import { db } from './db.ts';
import { cleanPeriods, nightCount, nightsOf, type ChosenNights, type NightRange } from '../shared/weekendNights.ts';

interface WeekendNights {
  days: number | null;
  starts_on: string | null;
  ends_on: string | null;
  periods: string;
}

type Sleeper = ChosenNights & { booking: string | null };

// The nights a participant of the weekend sleeps there: as chosen on the
// link, else by booked period.
export const nightsFor = (w: WeekendNights) => {
  const periods = cleanPeriods(JSON.parse(w.periods || '[]'));
  const nights = nightCount(w);
  return (p: Sleeper) => nightsOf(periods, nights, p.booking, p);
};

// The nights of everyone sleeping in a room (but `except`).
export const roomNights = (roomId: string, except: string | null = null): NightRange[] => {
  const weekend = db
    .prepare('select w.days, w.starts_on, w.ends_on, w.periods from weekend_rooms r join weekends w on w.id = r.weekend_id where r.id = ?')
    .get(roomId) as WeekendNights | undefined;
  if (!weekend) return [];
  const nights = nightsFor(weekend);
  return (
    db
      .prepare(
        `select wp.booking, wp.night_from, wp.night_to from weekend_room_assignments a join weekend_participants wp on wp.id = a.participant_id
         where a.room_id = ? and a.participant_id is not ?`,
      )
      .all(roomId, except) as Sleeper[]
  ).map(nights);
};
