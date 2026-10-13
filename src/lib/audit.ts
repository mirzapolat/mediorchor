// Wording for the audit log (Admin Config → Audit-Log): what the server's
// action keys, tables and columns (server/audit.ts) mean to a person.
import type { Language } from './config';

export type AuditCategory = 'auth' | 'data' | 'public' | 'files' | 'admin' | 'webhook' | 'system';
export type AuditOp = 'insert' | 'update' | 'delete';

export interface AuditRef {
  table: string;
  id: string;
  label: string | null;
}

export interface AuditChange {
  id: number;
  table: string;
  op: AuditOp;
  key: string | null;
  label: string | null;
  // insert/delete: { column: value }, update: { column: [old, new] }
  data: Record<string, unknown> | null;
  refs: Record<string, AuditRef> | null;
}

export interface AuditEntry {
  seq: number;
  id: string;
  at: string;
  actor: { kind: 'user' | 'anonymous' | 'system' | 'webhook'; id: string | null; name: string | null; email: string | null };
  category: AuditCategory;
  action: string;
  target: string | null;
  method: string | null;
  path: string | null;
  ip: string | null;
  user_agent: string | null;
  status: 'ok' | 'failed';
  error: string | null;
  details: Record<string, unknown> | null;
  change_count: number;
  changes: AuditChange[];
  change_summary: { table: string; op: AuditOp; count: number }[];
}

export interface AuditActor {
  id: string;
  name: string | null;
  email: string | null;
}

type Words = { de: string; en: string };

export const CATEGORY_LABEL: Record<AuditCategory, Words> = {
  auth: { de: 'Anmeldung & Sicherheit', en: 'Sign-in & security' },
  data: { de: 'Daten', en: 'Data' },
  public: { de: 'Öffentliche Formulare', en: 'Public forms' },
  files: { de: 'Dateien', en: 'Files' },
  admin: { de: 'Administration', en: 'Administration' },
  webhook: { de: 'Webhooks', en: 'Webhooks' },
  system: { de: 'System', en: 'System' },
};

const TABLES: Record<string, Words> = {
  absence_labels: { de: 'Fehlzeiten-Regel', en: 'Absence rule' },
  app_settings: { de: 'Instanz-Einstellungen', en: 'Instance settings' },
  app_users: { de: 'Konto', en: 'Account' },
  attendance: { de: 'Anwesenheit', en: 'Attendance' },
  auth_factors: { de: 'Authenticator-App', en: 'Authenticator app' },
  auth_passkeys: { de: 'Passkey', en: 'Passkey' },
  auth_users: { de: 'Zugangsdaten', en: 'Sign-in details' },
  calendar_event_exceptions: { de: 'Terminausnahme', en: 'Event exception' },
  calendar_events: { de: 'Kalendertermin', en: 'Calendar event' },
  calendar_links: { de: 'Kalender-Link', en: 'Calendar link' },
  calendar_projects: { de: 'Projekt im Kalender', en: 'Project in calendar' },
  calendars: { de: 'Kalender', en: 'Calendar' },
  checkin_submissions: { de: 'Check-in', en: 'Check-in' },
  event_checkins: { de: 'Check-in-Einstellung', en: 'Check-in setting' },
  event_pieces: { de: 'Stück im Probenplan', en: 'Piece in rehearsal plan' },
  events: { de: 'Probe', en: 'Rehearsal' },
  members: { de: 'Mitglied', en: 'Member' },
  piece_credits: { de: 'Mitwirkende', en: 'Credit' },
  piece_files: { de: 'Stückdatei', en: 'Piece file' },
  piece_tracks: { de: 'Übe-Spur', en: 'Practice track' },
  pieces: { de: 'Stück', en: 'Piece' },
  project_groups: { de: 'Gruppe', en: 'Group' },
  project_infos: { de: 'Projektinfo', en: 'Project info' },
  project_pieces: { de: 'Stück im Projekt', en: 'Piece in project' },
  projects: { de: 'Projekt', en: 'Project' },
  registration_pages: { de: 'Anmeldeseite', en: 'Registration page' },
  registrations: { de: 'Anmeldung', en: 'Registration' },
  smtp_settings: { de: 'E-Mail-Server', en: 'Mail server' },
};

const OPS: Record<AuditOp | 'upsert', Words> = {
  insert: { de: 'angelegt', en: 'created' },
  update: { de: 'geändert', en: 'changed' },
  delete: { de: 'gelöscht', en: 'deleted' },
  upsert: { de: 'gespeichert', en: 'saved' },
};

// Actions with a name of their own; data requests are named after their
// table and operation instead.
const ACTIONS: Record<string, Words> = {
  'auth.login': { de: 'Angemeldet', en: 'Signed in' },
  'auth.login.mfa': { de: 'Angemeldet (2. Faktor)', en: 'Signed in (second factor)' },
  'auth.passkey.login': { de: 'Mit Passkey angemeldet', en: 'Signed in with a passkey' },
  'auth.logout': { de: 'Abgemeldet', en: 'Signed out' },
  'auth.signup': { de: 'Selbst registriert', en: 'Signed up' },
  'auth.confirm': { de: 'E-Mail-Link bestätigt', en: 'Confirmed email link' },
  'auth.user.patch': { de: 'Zugangsdaten geändert', en: 'Changed sign-in details' },
  'auth.user.delete': { de: 'Eigenes Konto gelöscht', en: 'Deleted own account' },
  'auth.reauth': { de: 'Identität bestätigt', en: 'Confirmed identity' },
  'auth.mfa.enroll': { de: 'Authenticator-App wird eingerichtet', en: 'Started authenticator setup' },
  'auth.mfa.verify': { de: 'Authenticator-App aktiviert', en: 'Activated authenticator app' },
  'auth.mfa.unenroll': { de: 'Authenticator-App entfernt', en: 'Removed authenticator app' },
  'auth.mfa.passkeys': { de: 'Passkey hinzugefügt', en: 'Added a passkey' },
  'auth.mfa.passkeys.remove': { de: 'Passkey entfernt', en: 'Removed a passkey' },
  'auth.mfa.passkeys.rename': { de: 'Passkey umbenannt', en: 'Renamed a passkey' },
  'auth.mfa.email.enroll': { de: 'E-Mail-Codes angefordert', en: 'Requested email codes' },
  'auth.mfa.email.verify': { de: 'E-Mail-Codes aktiviert', en: 'Activated email codes' },
  'auth.mfa.email.disable': { de: 'E-Mail-Codes deaktiviert', en: 'Turned off email codes' },
  'auth.mfa.challenge.email': { de: 'Anmeldecode per E-Mail angefordert', en: 'Requested a code by email' },
  'auth.sessions.revoke': { de: 'Geräte abgemeldet', en: 'Signed out devices' },
  'admin.create-user': { de: 'Konto angelegt', en: 'Created an account' },
  'admin.delete-user': { de: 'Konto gelöscht', en: 'Deleted an account' },
  'admin.smtp-save': { de: 'E-Mail-Server gespeichert', en: 'Saved mail server' },
  'admin.smtp-delete': { de: 'E-Mail-Server entfernt', en: 'Removed mail server' },
  'admin.smtp-test': { de: 'E-Mail-Server getestet', en: 'Tested mail server' },
  'storage.upload': { de: 'Datei hochgeladen', en: 'Uploaded a file' },
  'storage.delete': { de: 'Datei gelöscht', en: 'Deleted a file' },
  'webhook.registration': { de: 'Anmeldung per Webhook', en: 'Registration via webhook' },
  'system.task': { de: 'Systemvorgang', en: 'System task' },
  'cli.create-admin': { de: 'Admin per Kommandozeile angelegt', en: 'Created admin via CLI' },
  'cli.make-admin': { de: 'Per Kommandozeile zum Admin gemacht', en: 'Made admin via CLI' },
  'cli.reset-password': { de: 'Passwort per Kommandozeile zurückgesetzt', en: 'Reset password via CLI' },
  'cli.disable-2fa': { de: '2FA per Kommandozeile entfernt', en: 'Removed 2FA via CLI' },
  'rpc.submit_public_checkin': { de: 'Eingecheckt', en: 'Checked in' },
  'rpc.submit_public_registration': { de: 'Über Formular angemeldet', en: 'Registered via form' },
  'rpc.assign_checkin_submission': { de: 'Check-in zugeordnet', en: 'Assigned a check-in' },
  'rpc.transfer_registration': { de: 'Anmeldung übernommen', en: 'Transferred a registration' },
  'rpc.transfer_all_registrations': { de: 'Alle Anmeldungen übernommen', en: 'Transferred all registrations' },
  'rpc.transfer_registration_selection': { de: 'Anmeldungen übernommen', en: 'Transferred registrations' },
  'rpc.remap_webhook_registrations': { de: 'Webhook-Anmeldungen neu zugeordnet', en: 'Remapped webhook registrations' },
  'rpc.claim_my_memberships': { de: 'Mitgliedschaften verknüpft', en: 'Linked memberships' },
  'rpc.join_project': { de: 'Projekt beigetreten', en: 'Joined a project' },
  'rpc.leave_project': { de: 'Projekt verlassen', en: 'Left a project' },
  'rpc.set_my_group': { de: 'Eigene Gruppe gewählt', en: 'Chose own group' },
  'rpc.lock_piece_markers': { de: 'Takt-Editor gesperrt', en: 'Locked bar editor' },
  'rpc.unlock_piece_markers': { de: 'Takt-Editor freigegeben', en: 'Released bar editor' },
  'rpc.create_piece': { de: 'Stück angelegt', en: 'Created a piece' },
};

const FAILED_ACTIONS: Record<string, Words> = {
  'auth.login': { de: 'Anmeldung fehlgeschlagen', en: 'Sign-in failed' },
  'auth.login.mfa': { de: 'Zweiter Faktor fehlgeschlagen', en: 'Second factor failed' },
  'auth.passkey.login': { de: 'Passkey-Anmeldung fehlgeschlagen', en: 'Passkey sign-in failed' },
  'auth.signup': { de: 'Registrierung fehlgeschlagen', en: 'Sign-up failed' },
  'auth.reauth': { de: 'Bestätigung fehlgeschlagen', en: 'Confirmation failed' },
};

const COLUMNS: Record<string, Words> = {
  name: { de: 'Name', en: 'Name' },
  first_name: { de: 'Vorname', en: 'First name' },
  last_name: { de: 'Nachname', en: 'Last name' },
  email: { de: 'E-Mail', en: 'Email' },
  password_hash: { de: 'Passwort', en: 'Password' },
  email_confirmed_at: { de: 'E-Mail bestätigt', en: 'Email confirmed' },
  email_2fa: { de: 'Codes per E-Mail', en: 'Email codes' },
  role: { de: 'Rolle', en: 'Role' },
  approved: { de: 'Freigegeben', en: 'Approved' },
  photo_url: { de: 'Foto', en: 'Photo' },
  group_name: { de: 'Gruppe', en: 'Group' },
  status: { de: 'Status', en: 'Status' },
  auditioned: { de: 'Vorgesungen', en: 'Auditioned' },
  project_id: { de: 'Projekt', en: 'Project' },
  event_id: { de: 'Probe', en: 'Rehearsal' },
  member_id: { de: 'Mitglied', en: 'Member' },
  piece_id: { de: 'Stück', en: 'Piece' },
  user_id: { de: 'Konto', en: 'Account' },
  calendar_id: { de: 'Kalender', en: 'Calendar' },
  registration_page_id: { de: 'Anmeldeseite', en: 'Registration page' },
  date: { de: 'Datum', en: 'Date' },
  end_date: { de: 'Enddatum', en: 'End date' },
  time: { de: 'Uhrzeit', en: 'Time' },
  start_time: { de: 'Beginn', en: 'Start' },
  end_time: { de: 'Ende', en: 'End' },
  location: { de: 'Ort', en: 'Location' },
  description: { de: 'Beschreibung', en: 'Description' },
  notes: { de: 'Notizen', en: 'Notes' },
  note: { de: 'Notiz', en: 'Note' },
  program_note: { de: 'Probenplan-Notiz', en: 'Plan note' },
  title: { de: 'Titel', en: 'Title' },
  composer: { de: 'Komponist*in', en: 'Composer' },
  archived: { de: 'Archiviert', en: 'Archived' },
  position: { de: 'Reihenfolge', en: 'Order' },
  color: { de: 'Farbe', en: 'Color' },
  is_active: { de: 'Aktiv', en: 'Active' },
  in_calendar: { de: 'Im Kalender', en: 'In calendar' },
  attendance_status: { de: 'Anwesenheitsstatus', en: 'Attendance status' },
  recognized: { de: 'Erkannt', en: 'Recognized' },
  transferred: { de: 'Übernommen', en: 'Transferred' },
  is_guest: { de: 'Gast', en: 'Guest' },
  token: { de: 'Geheimer Link', en: 'Secret link' },
  feed_token: { de: 'Abo-Link', en: 'Subscription link' },
  secret: { de: 'Geheimnis', en: 'Secret' },
  public_key: { de: 'Schlüssel', en: 'Key' },
  password_enc: { de: 'Passwort', en: 'Password' },
  host: { de: 'Server', en: 'Server' },
  port: { de: 'Port', en: 'Port' },
  username: { de: 'Benutzer', en: 'User' },
  from_address: { de: 'Absender', en: 'Sender' },
  language: { de: 'Sprache', en: 'Language' },
  home_page: { de: 'Startseite', en: 'Home page' },
  dashboard_layout: { de: 'Dashboard-Layout', en: 'Dashboard layout' },
  notify_reminders: { de: 'Erinnerungen', en: 'Reminders' },
  notify_status: { de: 'Status-Mails', en: 'Status emails' },
  notify_weekly: { de: 'Wochenübersicht', en: 'Weekly summary' },
  markers_locked_by: { de: 'Takt-Editor gesperrt von', en: 'Bar editor locked by' },
  markers_locked_name: { de: 'Gesperrt für', en: 'Locked for' },
  timeline: { de: 'Zeitleiste', en: 'Timeline' },
  bar_anchors: { de: 'Taktmarken', en: 'Bar markers' },
  bar_sync: { de: 'Taktsynchronisation', en: 'Bar sync' },
  bar_shift: { de: 'Taktverschiebung', en: 'Bar shift' },
  offset_s: { de: 'Versatz (s)', en: 'Offset (s)' },
  file_name: { de: 'Dateiname', en: 'File name' },
  file_path: { de: 'Datei', en: 'File' },
  url: { de: 'Link', en: 'Link' },
  link: { de: 'Link', en: 'Link' },
  text: { de: 'Text', en: 'Text' },
  links: { de: 'Links', en: 'Links' },
  conditions: { de: 'Bedingungen', en: 'Conditions' },
  repeat: { de: 'Wiederholung', en: 'Repeat' },
  cancelled: { de: 'Abgesagt', en: 'Cancelled' },
  allow_self_signup: { de: 'Selbstregistrierung', en: 'Self sign-up' },
  require_admin_2fa: { de: '2FA Pflicht', en: '2FA required' },
  session_days: { de: 'Sitzungsdauer (Tage)', en: 'Session length (days)' },
};

const words = (map: Record<string, Words>, key: string, lang: Language) => map[key]?.[lang];

const humanize = (key: string) => {
  const s = key.replace(/_id$/, '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const tableLabel = (table: string, lang: Language) => words(TABLES, table, lang) ?? humanize(table);
export const columnLabel = (column: string, lang: Language) => words(COLUMNS, column, lang) ?? humanize(column);
export const opLabel = (op: AuditOp | 'upsert', lang: Language) => OPS[op][lang];

// "Mitglied geändert", "Angemeldet", "Anmeldung fehlgeschlagen", …
export const actionLabel = (entry: AuditEntry, lang: Language): string => {
  const failed = entry.status === 'failed';
  if (failed && FAILED_ACTIONS[entry.action]) return FAILED_ACTIONS[entry.action][lang];
  const named = words(ACTIONS, entry.action, lang);
  if (named) return named;
  if (entry.action.startsWith('db.')) {
    const op = entry.action.slice(3);
    const table = entry.target ? tableLabel(entry.target, lang) : lang === 'de' ? 'Daten' : 'Data';
    if (op === 'insert' || op === 'update' || op === 'delete' || op === 'upsert') return `${table} ${opLabel(op, lang)}`;
    return lang === 'de' ? 'Datenanfrage' : 'Data request';
  }
  if (entry.action.startsWith('request.')) {
    return `${lang === 'de' ? 'Anfrage' : 'Request'} (${entry.method ?? entry.action.slice(8).toUpperCase()})`;
  }
  if (entry.action.startsWith('rpc.')) return humanize(entry.action.slice(4));
  return humanize(entry.action.replace(/^\w+\./, '').replace(/\./g, ' '));
};

// A change's own name, or the names it points to (an attendance: the member
// and the Probe).
export const changeTitle = (change: AuditChange): string | null => {
  if (change.label) return change.label;
  const refs = Object.values(change.refs ?? {})
    .map((r) => r.label)
    .filter(Boolean);
  return refs.length ? refs.join(' · ') : null;
};

// What the action was about: the name of the main row it touched.
export const entrySubject = (entry: AuditEntry): string | null => {
  const main = entry.changes.find((c) => c.table === entry.target) ?? entry.changes[0];
  if (main) return changeTitle(main);
  const file = entry.details?.file;
  if (typeof file === 'string') return file.split('/').pop() ?? file;
  return null;
};

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isSecret = (value: unknown) => typeof value === 'object' && value !== null && '$secret' in value;

export const formatValue = (value: unknown, lang: Language): string => {
  if (value === null || value === undefined || value === '') return '–';
  if (typeof value === 'boolean') return value ? (lang === 'de' ? 'ja' : 'yes') : lang === 'de' ? 'nein' : 'no';
  if (isSecret(value)) return '••••••';
  if (typeof value === 'object' && '$size' in value) {
    const size = Number((value as { $size: number }).$size).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US');
    return lang === 'de' ? `(${size} Zeichen)` : `(${size} characters)`;
  }
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return json.length > 160 ? `${json.slice(0, 160)}…` : json;
  }
  const text = String(value);
  const locale = lang === 'de' ? 'de-DE' : 'en-US';
  if (ISO_DATETIME.test(text) && !Number.isNaN(Date.parse(text))) {
    return new Date(text).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  }
  if (ISO_DATE.test(text)) return new Date(`${text}T12:00:00`).toLocaleDateString(locale, { dateStyle: 'medium' });
  return text;
};

// "Chrome auf macOS" from a user agent: enough to tell devices apart.
export const deviceLabel = (ua: string | null, lang: Language) => {
  if (!ua) return null;
  const browsers: [RegExp, string][] = [
    [/Edg\//, 'Edge'],
    [/OPR\//, 'Opera'],
    [/Firefox\//, 'Firefox'],
    [/Chrome\//, 'Chrome'],
    [/Safari\//, 'Safari'],
  ];
  const systems: [RegExp, string][] = [
    [/iPhone|iPad/, 'iOS'],
    [/Android/, 'Android'],
    [/Mac OS X|Macintosh/, 'macOS'],
    [/Windows/, 'Windows'],
    [/Linux/, 'Linux'],
  ];
  const browser = browsers.find(([re]) => re.test(ua))?.[1];
  const os = systems.find(([re]) => re.test(ua))?.[1];
  if (browser && os) return lang === 'de' ? `${browser} auf ${os}` : `${browser} on ${os}`;
  return browser ?? os ?? ua.slice(0, 60);
};
