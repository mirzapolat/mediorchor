import { localeOf, type Language } from '@shared/languages';
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
  status: 'draft' | 'published' | 'closed';
  archived: boolean;
  created_at: string;
  // The caller's own place in it.
  me: { confirmed: boolean; room_id: string | null };
  // Managers only.
  counts: { participants: number; confirmed: number; rooms: number } | null;
}

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
  weekend: { id: string; title: string; status: Weekend['status']; archived: boolean };
  manager: boolean;
  me: { participant_id: string; room_id: string | null } | null;
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

export const weekendState = (w: Pick<Weekend, 'status' | 'archived'>) => (w.archived ? 'archived' : w.status) as
  | 'draft'
  | 'published'
  | 'closed'
  | 'archived';
