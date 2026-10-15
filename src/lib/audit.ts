// Wording for the audit log (Admin Config → Audit-Log): what the server's
// action keys, tables and columns (server/audit.ts) mean to a person.
import { localeOf, type Language, type Localized } from '@shared/languages';

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

type Words = Localized;

export const CATEGORY_LABEL: Record<AuditCategory, Words> = {
  auth: { de: 'Anmeldung & Sicherheit', en: 'Sign-in & security', fi: 'Kirjautuminen ja tietoturva' },
  data: { de: 'Daten', en: 'Data', fi: 'Tiedot' },
  public: { de: 'Öffentliche Formulare', en: 'Public forms', fi: 'Julkiset lomakkeet' },
  files: { de: 'Dateien', en: 'Files', fi: 'Tiedostot' },
  admin: { de: 'Administration', en: 'Administration', fi: 'Ylläpito' },
  webhook: { de: 'Webhooks', en: 'Webhooks', fi: 'Webhookit' },
  system: { de: 'System', en: 'System', fi: 'Järjestelmä' },
};

const TABLES: Record<string, Words> = {
  absence_labels: { de: 'Fehlzeiten-Regel', en: 'Absence rule', fi: 'Poissaolosääntö' },
  app_settings: { de: 'Instanz-Einstellungen', en: 'Instance settings', fi: 'Instanssin asetukset' },
  app_users: { de: 'Konto', en: 'Account', fi: 'Tili' },
  attendance: { de: 'Anwesenheit', en: 'Attendance', fi: 'Läsnäolo' },
  auth_factors: { de: 'Authenticator-App', en: 'Authenticator app', fi: 'Todennussovellus' },
  auth_passkeys: { de: 'Passkey', en: 'Passkey', fi: 'Pääsyavain' },
  auth_users: { de: 'Zugangsdaten', en: 'Sign-in details', fi: 'Kirjautumistiedot' },
  calendar_event_exceptions: { de: 'Terminausnahme', en: 'Event exception', fi: 'Tapahtumapoikkeus' },
  calendar_events: { de: 'Kalendertermin', en: 'Calendar event', fi: 'Kalenteritapahtuma' },
  calendar_links: { de: 'Kalender-Link', en: 'Calendar link', fi: 'Kalenterilinkki' },
  calendar_projects: { de: 'Projekt im Kalender', en: 'Project in calendar', fi: 'Projekti kalenterissa' },
  calendars: { de: 'Kalender', en: 'Calendar', fi: 'Kalenteri' },
  checkin_submissions: { de: 'Check-in', en: 'Check-in', fi: 'Kuittaus' },
  event_checkins: { de: 'Check-in-Einstellung', en: 'Check-in setting', fi: 'Kuittausasetus' },
  event_pieces: { de: 'Stück im Probenplan', en: 'Piece in rehearsal plan', fi: 'Kappale harjoitusohjelmassa' },
  events: { de: 'Probe', en: 'Rehearsal', fi: 'Harjoitus' },
  members: { de: 'Mitglied', en: 'Member', fi: 'Jäsen' },
  piece_credits: { de: 'Mitwirkende', en: 'Credit', fi: 'Tekijä' },
  piece_files: { de: 'Stückdatei', en: 'Piece file', fi: 'Kappaletiedosto' },
  piece_tracks: { de: 'Übe-Spur', en: 'Practice track', fi: 'Harjoitusraita' },
  pieces: { de: 'Stück', en: 'Piece', fi: 'Kappale' },
  project_groups: { de: 'Gruppe', en: 'Group', fi: 'Ryhmä' },
  project_infos: { de: 'Projektinfo', en: 'Project info', fi: 'Projektin tiedot' },
  project_pieces: { de: 'Stück im Projekt', en: 'Piece in project', fi: 'Kappale projektissa' },
  projects: { de: 'Projekt', en: 'Project', fi: 'Projekti' },
  registration_pages: { de: 'Anmeldeseite', en: 'Registration page', fi: 'Ilmoittautumissivu' },
  registrations: { de: 'Anmeldung', en: 'Registration', fi: 'Ilmoittautuminen' },
  smtp_settings: { de: 'E-Mail-Server', en: 'Mail server', fi: 'Sähköpostipalvelin' },
};

const OPS: Record<AuditOp | 'upsert', Words> = {
  insert: { de: 'angelegt', en: 'created', fi: 'luotu' },
  update: { de: 'geändert', en: 'changed', fi: 'muutettu' },
  delete: { de: 'gelöscht', en: 'deleted', fi: 'poistettu' },
  upsert: { de: 'gespeichert', en: 'saved', fi: 'tallennettu' },
};

// Actions with a name of their own; data requests are named after their
// table and operation instead.
const ACTIONS: Record<string, Words> = {
  'auth.login': { de: 'Angemeldet', en: 'Signed in', fi: 'Kirjautui sisään' },
  'auth.login.mfa': { de: 'Angemeldet (2. Faktor)', en: 'Signed in (second factor)', fi: 'Kirjautui sisään (toinen vaihe)' },
  'auth.passkey.login': { de: 'Mit Passkey angemeldet', en: 'Signed in with a passkey', fi: 'Kirjautui pääsyavaimella' },
  'auth.logout': { de: 'Abgemeldet', en: 'Signed out', fi: 'Kirjautui ulos' },
  'auth.signup': { de: 'Selbst registriert', en: 'Signed up', fi: 'Rekisteröityi' },
  'auth.confirm': { de: 'E-Mail-Link bestätigt', en: 'Confirmed email link', fi: 'Vahvisti sähköpostilinkin' },
  'auth.user.patch': { de: 'Zugangsdaten geändert', en: 'Changed sign-in details', fi: 'Muutti kirjautumistietoja' },
  'auth.user.delete': { de: 'Eigenes Konto gelöscht', en: 'Deleted own account', fi: 'Poisti oman tilinsä' },
  'auth.reauth': { de: 'Identität bestätigt', en: 'Confirmed identity', fi: 'Vahvisti henkilöllisyyden' },
  'auth.mfa.enroll': { de: 'Authenticator-App wird eingerichtet', en: 'Started authenticator setup', fi: 'Aloitti todennussovelluksen käyttöönoton' },
  'auth.mfa.verify': { de: 'Authenticator-App aktiviert', en: 'Activated authenticator app', fi: 'Otti todennussovelluksen käyttöön' },
  'auth.mfa.unenroll': { de: 'Authenticator-App entfernt', en: 'Removed authenticator app', fi: 'Poisti todennussovelluksen' },
  'auth.mfa.passkeys': { de: 'Passkey hinzugefügt', en: 'Added a passkey', fi: 'Lisäsi pääsyavaimen' },
  'auth.mfa.passkeys.remove': { de: 'Passkey entfernt', en: 'Removed a passkey', fi: 'Poisti pääsyavaimen' },
  'auth.mfa.passkeys.rename': { de: 'Passkey umbenannt', en: 'Renamed a passkey', fi: 'Nimesi pääsyavaimen uudelleen' },
  'auth.mfa.email.enroll': { de: 'E-Mail-Codes angefordert', en: 'Requested email codes', fi: 'Pyysi sähköpostikoodeja' },
  'auth.mfa.email.verify': { de: 'E-Mail-Codes aktiviert', en: 'Activated email codes', fi: 'Otti sähköpostikoodit käyttöön' },
  'auth.mfa.email.disable': { de: 'E-Mail-Codes deaktiviert', en: 'Turned off email codes', fi: 'Poisti sähköpostikoodit käytöstä' },
  'auth.mfa.challenge.email': { de: 'Anmeldecode per E-Mail angefordert', en: 'Requested a code by email', fi: 'Pyysi koodin sähköpostilla' },
  'auth.sessions.revoke': { de: 'Geräte abgemeldet', en: 'Signed out devices', fi: 'Kirjasi laitteita ulos' },
  'auth.password-reset.request': { de: 'Passwort-Reset angefordert', en: 'Requested a password reset', fi: 'Pyysi salasanan palautusta' },
  'auth.password-reset': { de: 'Passwort per E-Mail-Link zurückgesetzt', en: 'Reset password via email link', fi: 'Palautti salasanan sähköpostilinkillä' },
  'admin.create-user': { de: 'Konto angelegt', en: 'Created an account', fi: 'Loi tilin' },
  'admin.delete-user': { de: 'Konto gelöscht', en: 'Deleted an account', fi: 'Poisti tilin' },
  'admin.send-password-reset': { de: 'Passwort-Reset-Link verschickt', en: 'Sent a password reset link', fi: 'Lähetti salasanan palautuslinkin' },
  'admin.smtp-save': { de: 'E-Mail-Server gespeichert', en: 'Saved mail server', fi: 'Tallensi sähköpostipalvelimen' },
  'admin.smtp-delete': { de: 'E-Mail-Server entfernt', en: 'Removed mail server', fi: 'Poisti sähköpostipalvelimen' },
  'admin.smtp-test': { de: 'E-Mail-Server getestet', en: 'Tested mail server', fi: 'Testasi sähköpostipalvelinta' },
  'storage.upload': { de: 'Datei hochgeladen', en: 'Uploaded a file', fi: 'Latasi tiedoston' },
  'storage.delete': { de: 'Datei gelöscht', en: 'Deleted a file', fi: 'Poisti tiedoston' },
  'webhook.registration': { de: 'Anmeldung per Webhook', en: 'Registration via webhook', fi: 'Ilmoittautuminen webhookin kautta' },
  'system.task': { de: 'Systemvorgang', en: 'System task', fi: 'Järjestelmätehtävä' },
  'cli.create-admin': { de: 'Admin per Kommandozeile angelegt', en: 'Created admin via CLI', fi: 'Loi ylläpitäjän komentoriviltä' },
  'cli.make-admin': { de: 'Per Kommandozeile zum Admin gemacht', en: 'Made admin via CLI', fi: 'Teki ylläpitäjäksi komentoriviltä' },
  'cli.reset-password': { de: 'Passwort per Kommandozeile zurückgesetzt', en: 'Reset password via CLI', fi: 'Palautti salasanan komentoriviltä' },
  'cli.disable-2fa': { de: '2FA per Kommandozeile entfernt', en: 'Removed 2FA via CLI', fi: 'Poisti 2FA:n komentoriviltä' },
  'rpc.submit_public_checkin': { de: 'Eingecheckt', en: 'Checked in', fi: 'Kuittasi paikalle' },
  'rpc.submit_public_registration': { de: 'Über Formular angemeldet', en: 'Registered via form', fi: 'Ilmoittautui lomakkeella' },
  'rpc.assign_checkin_submission': { de: 'Check-in zugeordnet', en: 'Assigned a check-in', fi: 'Yhdisti kuittauksen' },
  'rpc.transfer_registration': { de: 'Anmeldung übernommen', en: 'Transferred a registration', fi: 'Siirsi ilmoittautumisen' },
  'rpc.transfer_all_registrations': { de: 'Alle Anmeldungen übernommen', en: 'Transferred all registrations', fi: 'Siirsi kaikki ilmoittautumiset' },
  'rpc.transfer_registration_selection': { de: 'Anmeldungen übernommen', en: 'Transferred registrations', fi: 'Siirsi ilmoittautumisia' },
  'rpc.remap_webhook_registrations': { de: 'Webhook-Anmeldungen neu zugeordnet', en: 'Remapped webhook registrations', fi: 'Yhdisti webhook-ilmoittautumiset uudelleen' },
  'rpc.claim_my_memberships': { de: 'Mitgliedschaften verknüpft', en: 'Linked memberships', fi: 'Yhdisti jäsenyydet' },
  'rpc.join_project': { de: 'Projekt beigetreten', en: 'Joined a project', fi: 'Liittyi projektiin' },
  'rpc.leave_project': { de: 'Projekt verlassen', en: 'Left a project', fi: 'Lähti projektista' },
  'rpc.set_my_group': { de: 'Eigene Gruppe gewählt', en: 'Chose own group', fi: 'Valitsi oman ryhmän' },
  'rpc.lock_piece_markers': { de: 'Takt-Editor gesperrt', en: 'Locked bar editor', fi: 'Lukitsi tahtieditorin' },
  'rpc.unlock_piece_markers': { de: 'Takt-Editor freigegeben', en: 'Released bar editor', fi: 'Vapautti tahtieditorin' },
  'rpc.create_piece': { de: 'Stück angelegt', en: 'Created a piece', fi: 'Loi kappaleen' },
};

const FAILED_ACTIONS: Record<string, Words> = {
  'auth.login': { de: 'Anmeldung fehlgeschlagen', en: 'Sign-in failed', fi: 'Kirjautuminen epäonnistui' },
  'auth.login.mfa': { de: 'Zweiter Faktor fehlgeschlagen', en: 'Second factor failed', fi: 'Toinen vaihe epäonnistui' },
  'auth.passkey.login': { de: 'Passkey-Anmeldung fehlgeschlagen', en: 'Passkey sign-in failed', fi: 'Kirjautuminen pääsyavaimella epäonnistui' },
  'auth.signup': { de: 'Registrierung fehlgeschlagen', en: 'Sign-up failed', fi: 'Rekisteröityminen epäonnistui' },
  'auth.reauth': { de: 'Bestätigung fehlgeschlagen', en: 'Confirmation failed', fi: 'Vahvistus epäonnistui' },
  'auth.password-reset': { de: 'Passwort-Reset fehlgeschlagen', en: 'Password reset failed', fi: 'Salasanan palautus epäonnistui' },
};

const COLUMNS: Record<string, Words> = {
  name: { de: 'Name', en: 'Name', fi: 'Nimi' },
  first_name: { de: 'Vorname', en: 'First name', fi: 'Etunimi' },
  last_name: { de: 'Nachname', en: 'Last name', fi: 'Sukunimi' },
  email: { de: 'E-Mail', en: 'Email', fi: 'Sähköposti' },
  password_hash: { de: 'Passwort', en: 'Password', fi: 'Salasana' },
  email_confirmed_at: { de: 'E-Mail bestätigt', en: 'Email confirmed', fi: 'Sähköposti vahvistettu' },
  email_2fa: { de: 'Codes per E-Mail', en: 'Email codes', fi: 'Sähköpostikoodit' },
  role: { de: 'Rolle', en: 'Role', fi: 'Rooli' },
  approved: { de: 'Freigegeben', en: 'Approved', fi: 'Hyväksytty' },
  photo_url: { de: 'Foto', en: 'Photo', fi: 'Kuva' },
  group_name: { de: 'Gruppe', en: 'Group', fi: 'Ryhmä' },
  status: { de: 'Status', en: 'Status', fi: 'Tila' },
  auditioned: { de: 'Vorgesungen', en: 'Auditioned', fi: 'Koelaulettu' },
  project_id: { de: 'Projekt', en: 'Project', fi: 'Projekti' },
  event_id: { de: 'Probe', en: 'Rehearsal', fi: 'Harjoitus' },
  member_id: { de: 'Mitglied', en: 'Member', fi: 'Jäsen' },
  piece_id: { de: 'Stück', en: 'Piece', fi: 'Kappale' },
  user_id: { de: 'Konto', en: 'Account', fi: 'Tili' },
  calendar_id: { de: 'Kalender', en: 'Calendar', fi: 'Kalenteri' },
  registration_page_id: { de: 'Anmeldeseite', en: 'Registration page', fi: 'Ilmoittautumissivu' },
  date: { de: 'Datum', en: 'Date', fi: 'Päivämäärä' },
  end_date: { de: 'Enddatum', en: 'End date', fi: 'Päättymispäivä' },
  time: { de: 'Uhrzeit', en: 'Time', fi: 'Aika' },
  start_time: { de: 'Beginn', en: 'Start', fi: 'Alkaa' },
  end_time: { de: 'Ende', en: 'End', fi: 'Päättyy' },
  location: { de: 'Ort', en: 'Location', fi: 'Paikka' },
  description: { de: 'Beschreibung', en: 'Description', fi: 'Kuvaus' },
  notes: { de: 'Notizen', en: 'Notes', fi: 'Muistiinpanot' },
  note: { de: 'Notiz', en: 'Note', fi: 'Huomio' },
  program_note: { de: 'Probenplan-Notiz', en: 'Plan note', fi: 'Ohjelman huomio' },
  title: { de: 'Titel', en: 'Title', fi: 'Otsikko' },
  composer: { de: 'Komponist*in', en: 'Composer', fi: 'Säveltäjä' },
  archived: { de: 'Archiviert', en: 'Archived', fi: 'Arkistoitu' },
  position: { de: 'Reihenfolge', en: 'Order', fi: 'Järjestys' },
  color: { de: 'Farbe', en: 'Color', fi: 'Väri' },
  is_active: { de: 'Aktiv', en: 'Active', fi: 'Aktiivinen' },
  in_calendar: { de: 'Im Kalender', en: 'In calendar', fi: 'Kalenterissa' },
  attendance_status: { de: 'Anwesenheitsstatus', en: 'Attendance status', fi: 'Läsnäolon tila' },
  recognized: { de: 'Erkannt', en: 'Recognized', fi: 'Tunnistettu' },
  transferred: { de: 'Übernommen', en: 'Transferred', fi: 'Siirretty' },
  is_guest: { de: 'Gast', en: 'Guest', fi: 'Vieras' },
  token: { de: 'Geheimer Link', en: 'Secret link', fi: 'Salainen linkki' },
  feed_token: { de: 'Abo-Link', en: 'Subscription link', fi: 'Tilauslinkki' },
  secret: { de: 'Geheimnis', en: 'Secret', fi: 'Salaisuus' },
  public_key: { de: 'Schlüssel', en: 'Key', fi: 'Avain' },
  password_enc: { de: 'Passwort', en: 'Password', fi: 'Salasana' },
  host: { de: 'Server', en: 'Server', fi: 'Palvelin' },
  port: { de: 'Port', en: 'Port', fi: 'Portti' },
  username: { de: 'Benutzer', en: 'User', fi: 'Käyttäjä' },
  from_address: { de: 'Absender', en: 'Sender', fi: 'Lähettäjä' },
  language: { de: 'Sprache', en: 'Language', fi: 'Kieli' },
  home_page: { de: 'Startseite', en: 'Home page', fi: 'Aloitussivu' },
  dashboard_layout: { de: 'Dashboard-Layout', en: 'Dashboard layout', fi: 'Koontinäkymän asettelu' },
  notify_reminders: { de: 'Erinnerungen', en: 'Reminders', fi: 'Muistutukset' },
  notify_status: { de: 'Status-Mails', en: 'Status emails', fi: 'Tilaviestit' },
  notify_weekly: { de: 'Wochenübersicht', en: 'Weekly summary', fi: 'Viikkokatsaus' },
  markers_locked_by: { de: 'Takt-Editor gesperrt von', en: 'Bar editor locked by', fi: 'Tahtieditorin lukitsija' },
  markers_locked_name: { de: 'Gesperrt für', en: 'Locked for', fi: 'Lukittu käyttäjälle' },
  timeline: { de: 'Zeitleiste', en: 'Timeline', fi: 'Aikajana' },
  bar_anchors: { de: 'Taktmarken', en: 'Bar markers', fi: 'Tahtimerkinnät' },
  bar_sync: { de: 'Taktsynchronisation', en: 'Bar sync', fi: 'Tahtien tahdistus' },
  bar_shift: { de: 'Taktverschiebung', en: 'Bar shift', fi: 'Tahtien siirto' },
  offset_s: { de: 'Versatz (s)', en: 'Offset (s)', fi: 'Siirtymä (s)' },
  file_name: { de: 'Dateiname', en: 'File name', fi: 'Tiedostonimi' },
  file_path: { de: 'Datei', en: 'File', fi: 'Tiedosto' },
  url: { de: 'Link', en: 'Link', fi: 'Linkki' },
  link: { de: 'Link', en: 'Link', fi: 'Linkki' },
  text: { de: 'Text', en: 'Text', fi: 'Teksti' },
  links: { de: 'Links', en: 'Links', fi: 'Linkit' },
  conditions: { de: 'Bedingungen', en: 'Conditions', fi: 'Ehdot' },
  repeat: { de: 'Wiederholung', en: 'Repeat', fi: 'Toisto' },
  cancelled: { de: 'Abgesagt', en: 'Cancelled', fi: 'Peruttu' },
  allow_self_signup: { de: 'Selbstregistrierung', en: 'Self sign-up', fi: 'Rekisteröityminen' },
  require_admin_2fa: { de: '2FA Pflicht', en: '2FA required', fi: '2FA pakollinen' },
  session_days: { de: 'Sitzungsdauer (Tage)', en: 'Session length (days)', fi: 'Istunnon pituus (päivää)' },
};

const words = (map: Record<string, Words>, key: string, lang: Language) => map[key]?.[lang];

// Wording built from parts; {placeholders} are filled in below.
const TEXT = {
  data: { de: 'Daten', en: 'Data', fi: 'Tiedot' },
  dataRequest: { de: 'Datenanfrage', en: 'Data request', fi: 'Tietopyyntö' },
  request: { de: 'Anfrage', en: 'Request', fi: 'Pyyntö' },
  yes: { de: 'ja', en: 'yes', fi: 'kyllä' },
  no: { de: 'nein', en: 'no', fi: 'ei' },
  characters: { de: '({n} Zeichen)', en: '({n} characters)', fi: '({n} merkkiä)' },
  device: { de: '{browser} auf {os}', en: '{browser} on {os}', fi: '{browser}, {os}' },
} satisfies Record<string, Words>;

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
    const table = entry.target ? tableLabel(entry.target, lang) : TEXT.data[lang];
    if (op === 'insert' || op === 'update' || op === 'delete' || op === 'upsert') return `${table} ${opLabel(op, lang)}`;
    return TEXT.dataRequest[lang];
  }
  if (entry.action.startsWith('request.')) {
    return `${TEXT.request[lang]} (${entry.method ?? entry.action.slice(8).toUpperCase()})`;
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
  if (typeof value === 'boolean') return value ? TEXT.yes[lang] : TEXT.no[lang];
  if (isSecret(value)) return '••••••';
  if (typeof value === 'object' && '$size' in value) {
    const size = Number((value as { $size: number }).$size).toLocaleString(localeOf(lang));
    return TEXT.characters[lang].replace('{n}', size);
  }
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return json.length > 160 ? `${json.slice(0, 160)}…` : json;
  }
  const text = String(value);
  const locale = localeOf(lang);
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
  if (browser && os) return TEXT.device[lang].replace('{browser}', browser).replace('{os}', os);
  return browser ?? os ?? ua.slice(0, 60);
};
