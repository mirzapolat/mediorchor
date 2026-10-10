import type { Language } from '@/lib/config';
// Shared domain types mirroring the database schema (see server/migrations).

// Every account is the same kind of account; capability flags grant extra
// rights. An account without any flag is a participant: it only sees projects
// it participates in (via a members row linked through members.user_id).
// An account's permissions (see src/lib/roles.ts): Teilnehmer, Stimmeltern,
// Verwaltung, Admin.
export type UserRole = 'participant' | 'section_lead' | 'manager' | 'admin';

// Pages an account can pick as its start page (see app_users.home_page).
export type HomePage = 'dashboard' | 'projects' | 'pieces' | 'calendar';

export interface DashboardWidgetState {
  id: string;
  hidden: boolean;
}

export interface AppUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  name: string; // "first last", computed by the database (read-only)
  role: UserRole; // permissions; new accounts are Teilnehmer ('participant')
  photo_url: string | null; // set by the account holder, mirrored onto linked members
  photo_prompted_at: string | null; // when the one-time photo prompt was shown (null = not yet)
  approved: boolean; // false = self sign-up waiting for admin approval
  notify_reminders: boolean; // email: reminder before a Probe (opt-in)
  notify_status: boolean; // email: someone marked me excused/absent (opt-in)
  notify_weekly: boolean; // email: Monday overview (opt-in)
  language: Language | null; // for emails; the UI language is per device
  home_page: HomePage; // where `/` and signing in lead
  dashboard_layout: DashboardWidgetState[]; // widget order and visibility
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

// The info box at the top of "Meine Teilnahme" (one per project; managers edit
// it, participants only see it when it has text or links).
export interface ProjectInfoLink {
  label: string;
  url: string;
}

export interface ProjectInfo {
  project_id: string;
  text: string; // Markdown
  links: ProjectInfoLink[];
  updated_at: string;
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
  auditioned: boolean; // "Vorgesungen", ticked on the Fehlzeiten page
  created_at: string;
}

export interface Event {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  date: string | null; // ISO date
  time: string | null; // HH:MM
  end_time: string | null; // HH:MM; without one a rehearsal lasts an hour
  location: string | null; // free text, e.g. "Aula, Raum 2"
  // Unticked: left out of every calendar (Kalender tab, iCal feeds).
  in_calendar: boolean;
  // General note on the rehearsal's programme ("Bitte Bleistift mitbringen").
  program_note: string;
  created_at: string;
}

// A calendar (dashboard tab "Kalender"): the rehearsals of its projects plus
// its own events, subscribable through the feed token's iCal link.
export interface Calendar {
  id: string;
  name: string;
  color: string; // #rrggbb
  reminder_minutes: number | null; // default reminder in subscribed apps; null = none
  position: number;
  created_at: string;
}

// A subscription link of a calendar; the token is the credential for its
// iCal feed and public web view (/cal/<token>).
export interface CalendarLink {
  id: string;
  calendar_id: string;
  name: string;
  token: string;
  show_details: boolean; // false = no location, notes or links
  last_fetched_at: string | null;
  created_at: string;
}

export type CalendarRepeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface CalendarProject {
  id: string;
  calendar_id: string;
  project_id: string;
  created_at: string;
}

// An event outside any project, in a calendar's "Events" entry.
export interface CalendarEvent {
  id: string;
  calendar_id: string;
  name: string;
  date: string; // ISO date (first day)
  end_date: string | null; // last day of a multi-day event
  start_time: string | null; // HH:MM; none = all day
  end_time: string | null;
  location: string | null;
  notes: string | null;
  link: string | null;
  repeat: CalendarRepeat;
  repeat_interval: number; // every n days/weeks/months/years
  repeat_until: string | null; // last possible start (inclusive)
  created_at: string;
}

// One occurrence of a repeating manual event, keyed by the first day it
// originally falls on: cancelled, or replaced by these values.
export interface CalendarEventException {
  id: string;
  event_id: string;
  occurrence_date: string;
  cancelled: boolean;
  name: string;
  date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  notes: string | null;
  link: string | null;
  created_at: string;
}

// A piece assigned to a rehearsal, in running order, with what to prepare.
export interface EventPiece {
  id: string;
  event_id: string;
  piece_id: string;
  // What to rehearse/prepare, e.g. "T. 1–30".
  note: string;
  position: number;
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

// A piece of the collection shared by all projects; projects pick pieces
// from it (ProjectPiece).
export interface Piece {
  id: string;
  name: string;
  composer: string;
  // Short line shown in the list; notes are Markdown shown on the piece page.
  description: string;
  notes: string; // no longer shown (kept so no text is lost)
  timeline: PieceTimeline | null;
  // Length in seconds: set from the MusicXML, editable; null = unknown.
  duration_s: number | null;
  // The score PDF shown on the piece page and the MusicXML its bars are
  // read from, both picked from the piece's files.
  score_file_id: string | null;
  notation_file_id: string | null;
  // Marker position of each bar on the score PDF, keyed by bar label.
  bar_anchors: Record<string, BarAnchor>;
  // Added to every numeric bar label when shown (display only).
  bar_shift: number;
  // Archived pieces stay in their projects but can't be added to more.
  archived: boolean;
  created_at: string;
}

// A piece in a project, at its place in the project's running order.
export interface ProjectPiece {
  id: string;
  project_id: string;
  piece_id: string;
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
  // Audio only: lead-in silence measured at upload (a voice using the
  // recording starts with it).
  offset_s: number;
  position: number;
  created_at: string;
}

// A voice of a piece (Sopran, Alt, Tutti, …): one uploaded recording
// without and optionally one with metronome click, same timing.
export interface PieceTrack {
  id: string;
  piece_id: string;
  title: string;
  file_id: string | null;
  click_file_id: string | null;
  // Seconds of lead-in before the first bar (both recordings).
  offset_s: number;
  position: number;
  created_at: string;
}

// Someone credited on a piece, optionally linked to an account (whose
// profile photo is mirrored here, read-only).
export interface PieceCredit {
  id: string;
  piece_id: string;
  name: string;
  user_id: string | null;
  photo_url: string | null;
  // What they did; empty = made the MIDIs.
  role: string;
  position: number;
  created_at: string;
}

// One bar as it is played (repeats unfolded, so a label can occur twice).
// Times are seconds from the first bar, before the track's lead-in.
export interface TimelineBar {
  label: string;
  start: number;
  end: number;
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
  // 'audition': the project's audition rule (at most one; always shown to
  // participants as "you must / needn't audition yet").
  kind: 'tag' | 'audition';
  position: number;
  created_at: string;
}
