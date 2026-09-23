// Shared domain types mirroring the database schema (see server/migrations).

// Every account is the same kind of account; capability flags grant extra
// rights. An account without any flag is a participant: it only sees projects
// it participates in (via a members row linked through members.user_id).
export interface AppUser {
  id: string;
  email: string;
  name: string;
  is_admin: boolean; // full access; several accounts may hold this
  can_manage_projects: boolean; // project management (scoped via all_projects/user_projects)
  all_projects: boolean; // false → management limited to user_projects rows
  can_access_club: boolean; // access to the Vereinsmitglieder section (off by default)
  created_at: string;
}

export type ProjectStatus = 'active' | 'archived';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null; // round logo shown next to the name
  status: ProjectStatus;
  allow_account_access: boolean; // participants may open the project
  allow_account_checkin: boolean; // check-in forms offer signing in
  allow_account_signup: boolean; // registration forms offer signing in
  allow_guest_checkin: boolean; // check-in forms work without an account
  allow_guest_signup: boolean; // registration forms work without an account
  allow_participant_pieces: boolean; // participants see the Stücke page
  created_at: string;
  created_by: string | null;
}

// 'guest' members were added on the fly for a single event and are kept out of
// the regular project members list.
export type MemberStatus = 'active' | 'archived' | 'guest';

// A project's group. Members reference it by name (members.group_name); the
// database keeps renames and deletions in sync.
export interface ProjectGroup {
  id: string;
  project_id: string;
  name: string;
  color: string; // #rrggbb
  position: number;
  created_at: string;
}

export interface Member {
  id: string;
  project_id: string;
  first_name: string;
  last_name: string;
  group_name: string | null;
  email: string | null;
  photo_url: string | null;
  status: MemberStatus;
  user_id: string | null; // linked account; an active linked row = participation
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
  is_active: boolean;
  auto_transfer: boolean;
  source: RegistrationSource;
  webhook_mapping: WebhookMapping;
  webhook_last_payload: WebhookDelivery | null;
  webhook_last_received_at: string | null;
  webhook_last_status: string | null; // 'ok' or an error code
  created_at: string;
}

// 'form': the public registration form. 'webhook': entries arrive by POST
// from external tools (Google Forms, Power Automate, Zapier, IFTTT, …).
export type RegistrationSource = 'form' | 'webhook';

export type WebhookTarget = 'first_name' | 'last_name' | 'full_name' | 'email' | 'group_name';

// Incoming field name per target; unset targets are detected automatically.
export type WebhookMapping = Partial<Record<WebhookTarget, string>>;

export interface WebhookDelivery {
  fields: Record<string, string>;
  matched: Record<WebhookTarget, string | null>;
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
  user_id: string | null; // set when the registration was submitted with an account
  created_at: string;
}

export interface Piece {
  id: string;
  project_id: string;
  name: string;
  composer: string;
  position: number;
  created_at: string;
}

export type PieceBlockType = 'file' | 'audio' | 'link' | 'text';

// One content block on a piece's info page. Which fields are set depends on
// the type: file/audio use file_path + file_name, link uses url, text uses
// content (Markdown).
export interface PieceBlock {
  id: string;
  piece_id: string;
  type: PieceBlockType;
  title: string;
  url: string | null;
  file_path: string | null;
  file_name: string | null;
  content: string | null;
  // Audio blocks may map the recording onto score bars (Takte); the practice
  // page then lets playback start at any bar between bars_start and bars_end.
  has_bars: boolean;
  bars_start: number | null;
  bars_end: number | null;
  // Optional score PDF shown on the practice page; bars can be anchored onto
  // it (keyed by bar number) so their buttons sit on the sheet music.
  score_path: string | null;
  score_name: string | null;
  bar_anchors: Record<string, BarAnchor>;
  position: number;
  created_at: string;
}

// Position of a bar button on the score PDF: page number (1-based) and the
// x/y position as fractions of the page size, so it scales with any width.
export interface BarAnchor {
  page: number;
  x: number;
  y: number;
}

// Saved absence-condition preset. `conditions` holds StoredCondition[] (see
// lib/absenceConditions). Public labels are shown to matching participants on
// their "Meine Teilnahme" page.
export interface AbsenceLabel {
  id: string;
  project_id: string;
  name: string;
  conditions: import('@/lib/absenceConditions').StoredCondition[];
  is_public: boolean;
  position: number;
  created_at: string;
}
