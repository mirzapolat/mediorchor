// Shared domain types mirroring the Supabase schema (see supabase/schema.sql).

export type Role = 'owner' | 'member';

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  all_projects: boolean; // false → access limited to user_projects rows
  can_access_projects: boolean; // access to the projects section (on by default)
  can_access_club: boolean; // access to the Vereinsmitglieder section (off by default)
  created_at: string;
}

export interface AppSettings {
  id: number;
  app_name: string;
  accent_color: string;
  icon: string | null; // lucide icon name
  language: 'de' | 'en';
}

export type ProjectStatus = 'active' | 'archived';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null; // round logo shown next to the name
  status: ProjectStatus;
  created_at: string;
  created_by: string | null;
}

// 'guest' members were added on the fly for a single event and are kept out of
// the regular project members list.
export type MemberStatus = 'active' | 'archived' | 'guest';

export interface Member {
  id: string;
  project_id: string;
  first_name: string;
  last_name: string;
  group_name: string | null;
  email: string | null;
  photo_url: string | null;
  status: MemberStatus;
  created_at: string;
}

export type ClubMemberStatus = 'active' | 'passive';

// Workspace-wide association member directory — unrelated to project `members`.
export interface ClubMember {
  id: string;
  title: string | null;
  salutation: string | null;
  first_name: string;
  last_name: string;
  care_of: string | null; // "Zusatz / c/o"
  street: string | null; // "Straße und Hausnummer"
  address_extra: string | null; // "Adresszusatz"
  postal_code: string | null; // "PLZ"
  city: string | null; // "Ort / Stadt"
  country: string | null; // "Land"
  email: string | null;
  phone: string | null;
  status: ClubMemberStatus;
  created_at: string;
}

export interface Event {
  id: string;
  project_id: string;
  name: string;
  date: string | null; // ISO date
  time: string | null; // HH:MM
  created_at: string;
}

export type AttendanceStatus = 'not_attended' | 'attended' | 'excused';

export interface Attendance {
  id: string;
  event_id: string;
  member_id: string;
  status: AttendanceStatus;
  is_guest: boolean;
}

export interface EventCheckin {
  event_id: string;
  token: string;
  is_active: boolean;
  attendance_status: Extract<AttendanceStatus, 'attended' | 'excused'>;
  show_logo: boolean;
  updated_at: string;
}

export interface CheckinSubmission {
  id: string;
  event_id: string;
  member_id: string | null;
  first_name: string;
  last_name: string;
  group_name: string;
  recognized: boolean;
  attendance_status: Extract<AttendanceStatus, 'attended' | 'excused'> | null;
  submitted_at: string;
}

export interface RegistrationPage {
  id: string;
  project_id: string;
  token: string;
  title: string;
  description: string;
  ask_email: boolean;
  ask_group: boolean;
  groups: string[];
  is_active: boolean;
  auto_transfer: boolean;
  created_at: string;
}

export interface Registration {
  id: string;
  registration_page_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  group_name: string | null;
  member_id: string | null;
  transferred: boolean;
  created_at: string;
}

// A member joined with their attendance status for a given event.
export interface AttendanceRow {
  member: Member;
  status: AttendanceStatus;
  is_guest: boolean;
  attendance_id: string | null;
}
