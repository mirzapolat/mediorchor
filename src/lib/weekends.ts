import { localeOf, type Language } from '@shared/languages';
import { dayCount, type BookingPeriod, type NightRange } from '@shared/weekendNights';
import { useOutletContext } from 'react-router-dom';
import type { ProjectOutletContext } from '@/layouts/projectContext';

// A rehearsal weekend as weekend_list (server/weekends.ts) returns it.
export interface Weekend {
  id: string;
  project_id: string;
  title: string;
  starts_on: string | null;
  ends_on: string | null;
  location: string;
  description: string;
  signup_url: string | null;
  // Released one by one (migration 0076): the details, and the rooms
  // (participants choose while 'open'; 'locked' shows them unchanged).
  details_published: boolean;
  rooms_status: RoomsStatus;
  // Days (null: from the dates) and the booked periods placed over nights.
  days: number | null;
  periods: BookingPeriod[];
  // The shared link to the room choice (managers only; null: none).
  link_token: string | null;
  archived: boolean;
  created_at: string;
  // The caller's own place in it.
  me: { confirmed: boolean; room_id: string | null };
  // Managers only.
  counts: { participants: number; confirmed: number; rooms: number } | null;
}

export type RoomsStatus = 'hidden' | 'open' | 'locked';

export interface WeekendParticipant {
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
  changed_by_hand: boolean;
  // The booked period as imported (free text), and nights chosen on the
  // shared link (they win).
  booking: string | null;
  night_from: number | null;
  night_to: number | null;
  created_at: string;
}

export interface WeekendImport {
  id: string;
  source: 'csv' | 'paste';
  file_name: string | null;
  created_by_name: string;
  stats: { new?: number; recognized?: number; manual?: number; skipped?: number; new_members?: number };
  undone_at: string | null;
  created_at: string;
}

export interface RoomPerson {
  participant_id: string;
  name: string;
  group_name: string | null;
  photo_url: string | null;
  kind: 'member' | 'guest' | 'pending';
  mine: boolean;
  booking: string | null;
  nights: NightRange;
}

export interface Room {
  id: string;
  weekend_id: string;
  name: string;
  description: string;
  capacity: number;
  position: number;
  occupants: RoomPerson[];
}

export interface RoomsView {
  weekend: { id: string; title: string; rooms_status: RoomsStatus; archived: boolean };
  manager: boolean;
  night_count: number;
  me: { participant_id: string; room_id: string | null; nights: NightRange } | null;
  can_choose: boolean;
  rooms: Room[];
  unassigned: RoomPerson[];
}

// What the weekend pages share through WeekendLayout.
export interface WeekendContext extends ProjectOutletContext {
  weekend: Weekend;
  reloadWeekend: () => Promise<void>;
}

export const useWeekendContext = () => useOutletContext<WeekendContext>();

// "6.–8. Nov. 2026", "6. Nov. – 2. Dez.", or a single day.
export const weekendDates = (w: Pick<Weekend, 'starts_on' | 'ends_on'>, lang: Language) => {
  const locale = localeOf(lang);
  const day = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(`${iso}T00:00:00`).toLocaleDateString(locale, opts);
  if (!w.starts_on) return null;
  if (!w.ends_on || w.ends_on === w.starts_on) return day(w.starts_on, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return `${day(w.starts_on, { day: 'numeric', month: 'short' })} – ${day(w.ends_on, { day: 'numeric', month: 'short', year: 'numeric' })}`;
};

// The weekend's days as tiles: weekday and date when it has a start, else
// "Tag 1", "Tag 2", ….
export const weekendDayLabels = (w: Pick<Weekend, 'days' | 'starts_on' | 'ends_on'>, lang: Language, dayWord: string) => {
  const locale = localeOf(lang);
  return Array.from({ length: dayCount(w) }, (_, i) => {
    if (!w.starts_on) return { weekday: `${dayWord} ${i + 1}`, date: null };
    const day = new Date(`${w.starts_on}T00:00:00`);
    day.setDate(day.getDate() + i);
    return {
      weekday: day.toLocaleDateString(locale, { weekday: 'short' }),
      date: day.toLocaleDateString(locale, { day: 'numeric', month: 'numeric' }),
    };
  });
};

// "Nacht 1", or "Nacht 1–2" for a range.
export const nightsLabel = ([from, to]: NightRange, nightWord: string) =>
  from === to ? `${nightWord} ${from + 1}` : `${nightWord} ${from + 1}–${to + 1}`;

// The shared link to a weekend's room choice.
export const weekendLinkUrl = (token: string) => `${window.location.origin}/zimmer/${token}`;

// A guest's key for the link, kept in this browser only.
const guestKeyName = (token: string) => `weekend-guest:${token}`;

export const loadGuestKey = (token: string) => {
  try {
    return localStorage.getItem(guestKeyName(token));
  } catch {
    return null;
  }
};

export const saveGuestKey = (token: string, key: string | null) => {
  try {
    if (key) localStorage.setItem(guestKeyName(token), key);
    else localStorage.removeItem(guestKeyName(token));
  } catch {
    // Without storage the guest simply can't come back by themselves.
  }
};
