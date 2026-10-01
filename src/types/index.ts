import type { Language } from '@/lib/config';
// Shared domain types mirroring the database schema (see server/migrations).

// Every account is the same kind of account; capability flags grant extra
// rights. An account without any flag is a participant: it only sees projects
// it participates in (via a members row linked through members.user_id).
export interface AppUser {
  id: string;
  email: string;
  name: string;
  is_admin: boolean; // full access; several accounts may hold this
  can_manage_projects: boolean; // manages every project; single projects are granted via user_projects
  can_access_club: boolean; // access to the Vereinsmitglieder section (off by default)
  photo_url: string | null; // set by the account holder, mirrored onto linked members
  photo_prompted_at: string | null; // when the one-time photo prompt was shown (null = not yet)
  approved: boolean; // false = self sign-up waiting for admin approval
  notify_reminders: boolean; // email: reminder before a Probe (opt-in)
  notify_status: boolean; // email: someone marked me excused/absent (opt-in)
  notify_weekly: boolean; // email: Monday overview (opt-in)
  language: Language | null; // for emails; the UI language is per device
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
  require_signup_group: boolean; // sign-ups must name a group (when the project has any)
  default_group: string | null; // group for new members added without one
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
  photo_url: string | null; // mirrors the linked account's photo (read-only)
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
  description: string | null;
  date: string | null; // ISO date
  time: string | null; // HH:MM
  created_at: string;
}

export type AttendanceStatus = 'not_attended' | 'attended' | 'excused';

// What a member's row shows for one Probe. Past Proben use the stored status
// (no record = not_attended); upcoming ones show 'expected' (marked present in
// advance), 'excused' or 'upcoming' (nothing recorded yet).
export type AttendanceDisplayStatus = AttendanceStatus | 'expected' | 'upcoming';

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
  // Form sources: no registrations from this ISO timestamp on (null = open).
  closes_at: string | null;
  // Form sources: optional cover image of the public page (/files/photos/...).
  cover_url: string | null;
  // Header of the public page: app branding, a custom text, or nothing.
  header_mode: RegistrationHeaderMode;
  header_text: string | null;
  // Background tint of the public page (#rrggbb); null = accent color.
  tint_color: string | null;
  // Label of an extra field that only helps sorting out registrations: shown
  // in the list, never transferred to the member. null = no such field.
  note_label: string | null;
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

export type RegistrationHeaderMode = 'app' | 'custom' | 'none';

// `note` feeds the page's extra field; it is never detected automatically.
export type WebhookTarget = 'first_name' | 'last_name' | 'full_name' | 'email' | 'group_name' | 'note';

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
  // Value of the page's extra field (see RegistrationPage.note_label).
  note: string | null;
  member_id: string | null;
  transferred: boolean;
  user_id: string | null; // set when the registration was submitted with an account
  // Fields a webhook registration arrived with (for re-mapping); null for form
  // sign-ups, older webhook entries and rows edited by hand.
  raw_payload: Record<string, string> | null;
  created_at: string;
}

export interface Piece {
  id: string;
  project_id: string;
  name: string;
  composer: string;
  // Short line shown in the list; notes are Markdown shown on the piece page.
  description: string;
  notes: string; // no longer shown (kept so no text is lost)
  // Who made the MIDI files: a name, optionally linked to an account whose
  // profile photo is mirrored onto the piece (read-only).
  midi_credit_name: string;
  midi_credit_user_id: string | null;
  midi_credit_photo_url: string | null;
  timeline: PieceTimeline | null;
  // Marker position of each bar on the score PDF, keyed by bar label.
  bar_anchors: Record<string, BarAnchor>;
  position: number;
  created_at: string;
}

// What a piece file is for. score = the PDF shown on the practice page,
// notation = MusicXML the bar timeline is read from, audio = one voice track.
export type PieceFileKind = 'score' | 'notation' | 'midi' | 'audio' | 'other' | 'link';

export interface PieceFile {
  id: string;
  piece_id: string;
  kind: PieceFileKind;
  // Display name; for audio tracks the voice (Sopran, Alt, Tutti, …).
  title: string;
  url: string | null;
  file_path: string | null;
  file_name: string | null;
  // Audio only: seconds of lead-in before the first bar.
  offset_s: number;
  // Audio only: the recording already contains a metronome click.
  has_click: boolean;
  position: number;
  created_at: string;
}

// One bar as it is played (repeats unfolded, so a label can occur twice).
// Times are seconds from the first bar, before the track's lead-in.
export interface TimelineBar {
  label: string;
  start: number;
  end: number;
  // Metronome beats as seconds from the bar start, from the meter and tempo
  // in the notation file (missing on timelines read before the metronome).
  beats?: number[];
  // Whether the first beat is the bar's downbeat (not in a pickup bar).
  downbeat?: boolean;
}

// The bar timeline shared by all audio tracks of a piece: either read from a
// notation file (exact, handles tempo/meter changes and repeats) or bars
// spread evenly across the recording.
export type PieceTimeline =
  | { source: 'even'; first: number; last: number }
  | {
      source: 'notation';
      bars: TimelineBar[];
      // Number of bars in the score (without repeats) and tempo/meter changes.
      written: number;
      tempoChanges: number;
      meterChanges: number;
      repeats: number;
    };

// A bar's mark on the score PDF: page number (1-based) and a frame (or, in
// older data, a point) as fractions of the page size, so it scales with any width.
export interface BarAnchor {
  page: number;
  x: number;
  y: number;
  // Frame size; marks without it are points (older data).
  w?: number;
  h?: number;
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
