import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_LANGUAGE, type Language } from './config';

// Minimal in-app i18n. The default language comes from VITE_DEFAULT_LANGUAGE but
// the user can switch at runtime; the choice is persisted to localStorage.

type Dict = Record<string, { de: string; en: string }>;

const dict: Dict = {
  // Generic
  appTagline: { de: 'Anwesenheitsverwaltung', en: 'Attendance management' },
  signIn: { de: 'Anmelden', en: 'Sign in' },
  signOut: { de: 'Abmelden', en: 'Sign out' },
  email: { de: 'E-Mail', en: 'Email' },
  password: { de: 'Passwort', en: 'Password' },
  name: { de: 'Name', en: 'Name' },
  save: { de: 'Speichern', en: 'Save' },
  cancel: { de: 'Abbrechen', en: 'Cancel' },
  create: { de: 'Erstellen', en: 'Create' },
  edit: { de: 'Bearbeiten', en: 'Edit' },
  delete: { de: 'Löschen', en: 'Delete' },
  archive: { de: 'Archivieren', en: 'Archive' },
  unarchive: { de: 'Wiederherstellen', en: 'Restore' },
  add: { de: 'Hinzufügen', en: 'Add' },
  close: { de: 'Schließen', en: 'Close' },
  search: { de: 'Suchen', en: 'Search' },
  all: { de: 'Alle', en: 'All' },
  active: { de: 'Aktiv', en: 'Active' },
  status: { de: 'Status', en: 'Status' },
  timeframe: { de: 'Zeitraum', en: 'Timeframe' },
  upcoming: { de: 'Bevorstehend', en: 'Upcoming' },
  past: { de: 'Vergangen', en: 'Past' },
  noResults: { de: 'Keine Ergebnisse', en: 'No results' },
  loading: { de: 'Lädt…', en: 'Loading…' },
  confirm: { de: 'Bestätigen', en: 'Confirm' },
  optional: { de: 'optional', en: 'optional' },
  back: { de: 'Zurück', en: 'Back' },
  actions: { de: 'Aktionen', en: 'Actions' },
  clearFilters: { de: 'Zurücksetzen', en: 'Reset' },
  collapse: { de: 'Einklappen', en: 'Collapse' },
  expand: { de: 'Ausklappen', en: 'Expand' },
  remove: { de: 'Entfernen', en: 'Remove' },

  // Nav
  projects: { de: 'Projekte', en: 'Projects' },
  users: { de: 'Benutzer', en: 'Users' },
  adminConfig: { de: 'Admin Config', en: 'Admin Config' },
  adminSettings: { de: 'Admin-Einstellungen', en: 'Admin settings' },
  settings: { de: 'Einstellungen', en: 'Settings' },
  configuration: { de: 'Konfiguration', en: 'Configuration' },
  account: { de: 'Konto', en: 'Account' },
  events: { de: 'Veranstaltungen', en: 'Events' },
  members: { de: 'Mitglieder', en: 'Members' },
  absences: { de: 'Fehlzeiten', en: 'Absences' },
  checkIn: { de: 'Check-in', en: 'Check-in' },

  // Auth
  loginTitle: { de: 'Willkommen zurück', en: 'Welcome back' },
  loginSubtitle: { de: 'Melde dich bei deinem Konto an', en: 'Sign in to your account' },
  invalidCredentials: { de: 'Ungültige Anmeldedaten', en: 'Invalid credentials' },
  notConfigured: {
    de: 'Supabase ist nicht konfiguriert. Setze VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY.',
    en: 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  },

  // Projects
  newProject: { de: 'Neues Projekt', en: 'New project' },
  editProject: { de: 'Projekt bearbeiten', en: 'Edit project' },
  projectName: { de: 'Projektname', en: 'Project name' },
  description: { de: 'Beschreibung', en: 'Description' },
  color: { de: 'Farbe', en: 'Color' },
  icon: { de: 'Symbol', en: 'Icon' },
  noProjects: { de: 'Noch keine Projekte', en: 'No projects yet' },
  projectImage: { de: 'Projektbild', en: 'Project image' },
  showArchived: { de: 'Archivierte anzeigen', en: 'Show archived' },
  hideArchived: { de: 'Archivierte verbergen', en: 'Hide archived' },
  archived: { de: 'Archiviert', en: 'Archived' },

  // Users
  newUser: { de: 'Neuer Benutzer', en: 'New user' },
  owner: { de: 'Admin', en: 'Admin' },
  member: { de: 'Mitglied', en: 'Member' },
  role: { de: 'Rolle', en: 'Role' },
  transferOwnership: { de: 'Admin übertragen', en: 'Transfer admin' },
  deleteUser: { de: 'Benutzer löschen', en: 'Delete user' },
  confirmDeleteUser: {
    de: 'Diesen Benutzer endgültig löschen? Der Zugang wird sofort entzogen.',
    en: 'Permanently delete this user? Their access is revoked immediately.',
  },
  ownerOnly: {
    de: 'Nur der Admin kann diese Seite sehen.',
    en: 'Only the admin can view this page.',
  },
  projectAccess: { de: 'Projektzugriff', en: 'Project access' },
  manageAccess: { de: 'Zugriff verwalten', en: 'Manage access' },
  allProjectsAccess: { de: 'Zugriff auf alle Projekte', en: 'Access to all projects' },
  allProjectsHint: {
    de: 'Wenn aktiv, kann dieser Benutzer auf alle aktuellen und zukünftigen Projekte zugreifen.',
    en: 'When on, this user can access all current and future projects.',
  },
  selectedProjects: { de: 'Ausgewählte Projekte', en: 'Selected projects' },
  accessFor: { de: 'Zugriff für', en: 'Access for' },

  // Account
  twoFactor: { de: 'Zwei-Faktor-Authentifizierung', en: 'Two-factor authentication' },
  enable2fa: { de: '2FA aktivieren', en: 'Enable 2FA' },
  disable2fa: { de: '2FA deaktivieren', en: 'Disable 2FA' },
  changePassword: { de: 'Passwort ändern', en: 'Change password' },
  newPassword: { de: 'Neues Passwort', en: 'New password' },
  language: { de: 'Sprache', en: 'Language' },

  // Settings
  appName: { de: 'App-Name', en: 'App name' },
  accentColor: { de: 'Akzentfarbe', en: 'Accent color' },
  branding: { de: 'Branding', en: 'Branding' },
  smtp: { de: 'SMTP / E-Mail', en: 'SMTP / Email' },
  smtpNote: {
    de: 'SMTP wird über Umgebungsvariablen konfiguriert (siehe .env).',
    en: 'SMTP is configured via environment variables (see .env).',
  },

  // Members
  newMember: { de: 'Neues Mitglied', en: 'New member' },
  editMember: { de: 'Mitglied bearbeiten', en: 'Edit member' },
  firstName: { de: 'Vorname', en: 'First name' },
  lastName: { de: 'Nachname', en: 'Last name' },
  group: { de: 'Gruppe', en: 'Group' },
  photo: { de: 'Foto', en: 'Photo' },
  noMembers: { de: 'Noch keine Mitglieder', en: 'No members yet' },
  guest: { de: 'Gast', en: 'Guest' },
  selectOrCreateGroup: {
    de: 'Gruppe wählen oder neu eingeben',
    en: 'Select or type a new group',
  },

  // CSV import
  importCsv: { de: 'CSV importieren', en: 'Import CSV' },
  importMembers: { de: 'Mitglieder importieren', en: 'Import members' },
  selectCsvFile: { de: 'CSV-Datei auswählen', en: 'Select CSV file' },
  changeFile: { de: 'Andere Datei', en: 'Change file' },
  firstRowHeader: {
    de: 'Erste Zeile enthält Spaltennamen',
    en: 'First row contains column names',
  },
  nameFormat: { de: 'Namensformat', en: 'Name format' },
  nameSeparate: {
    de: 'Vor- und Nachname getrennt',
    en: 'First and last name separate',
  },
  nameCombined: {
    de: 'Voller Name in einem Feld',
    en: 'Full name in one field',
  },
  nameCombinedHint: {
    de: 'Der Name wird beim letzten Leerzeichen in Vor- und Nachname getrennt.',
    en: 'The name is split into first and last name at the last space.',
  },
  fullName: { de: 'Voller Name', en: 'Full name' },
  mapColumns: { de: 'Spalten zuordnen', en: 'Map columns' },
  mapColumnsHint: {
    de: 'Lege fest, welche Spalte der CSV welchem Feld entspricht.',
    en: 'Choose which CSV column maps to which field.',
  },
  csvColumnFor: { de: 'CSV-Spalte für', en: 'CSV column for' },
  notMapped: { de: '— nicht zuordnen —', en: '— do not map —' },
  preview: { de: 'Vorschau', en: 'Preview' },
  rowsReadyToImport: {
    de: '{n} von {total} Zeilen werden importiert',
    en: '{n} of {total} rows will be imported',
  },
  rowsSkippedHint: {
    de: 'Zeilen ohne Vor- und Nachname werden übersprungen.',
    en: 'Rows without a first and last name are skipped.',
  },
  import: { de: 'Importieren', en: 'Import' },
  importing: { de: 'Importiere…', en: 'Importing…' },
  noRowsToImport: {
    de: 'Keine gültigen Zeilen zum Importieren.',
    en: 'No valid rows to import.',
  },
  emptyCsv: { de: 'Die Datei enthält keine Daten.', en: 'The file contains no data.' },
  andMore: { de: '… und {n} weitere', en: '… and {n} more' },

  // Events
  newEvent: { de: 'Neue Veranstaltung', en: 'New event' },
  editEvent: { de: 'Veranstaltung bearbeiten', en: 'Edit event' },
  eventName: { de: 'Veranstaltungsname', en: 'Event name' },
  date: { de: 'Datum', en: 'Date' },
  time: { de: 'Uhrzeit', en: 'Time' },
  noEvents: { de: 'Noch keine Veranstaltungen', en: 'No events yet' },
  attendance: { de: 'Anwesenheit', en: 'Attendance' },
  attended: { de: 'Anwesend', en: 'Present' },
  excused: { de: 'Entschuldigt', en: 'Excused' },
  notAttended: { de: 'Abwesend', en: 'Absent' },
  addMemberToEvent: { de: 'Mitglied hinzufügen', en: 'Add member' },
  addAsGuest: { de: 'Als Gast hinzufügen', en: 'Add as guest' },
  addToProject: { de: 'Zum Projekt hinzufügen', en: 'Add to project' },
  guestOrMember: {
    de: 'Soll diese Person als Gast oder als Projektmitglied hinzugefügt werden?',
    en: 'Should this person be added as a guest or as a project member?',
  },
  present: { de: 'Anwesend', en: 'Present' },
  absenceConditions: { de: 'Bedingungen', en: 'Conditions' },
  absenceConditionsHint: {
    de: 'Kombiniere Anwesenheitswerte mit UND oder ODER.',
    en: 'Combine attendance values with AND or OR.',
  },
  addCondition: { de: 'Bedingung hinzufügen', en: 'Add condition' },
  conditionMetric: { de: 'Wert', en: 'Metric' },
  comparison: { de: 'Vergleich', en: 'Comparison' },
  count: { de: 'Anzahl', en: 'Count' },
  when: { de: 'Wenn', en: 'When' },
  and: { de: 'UND', en: 'AND' },
  or: { de: 'ODER', en: 'OR' },
  atLeast: { de: 'mindestens', en: 'at least' },
  moreThan: { de: 'mehr als', en: 'more than' },
  exactly: { de: 'genau', en: 'exactly' },
  lessThan: { de: 'weniger als', en: 'less than' },
  atMost: { de: 'höchstens', en: 'at most' },
  matchingMembers: { de: 'Gefundene Mitglieder', en: 'Matching members' },
  noAbsenceResults: {
    de: 'Keine Mitglieder entsprechen diesen Bedingungen.',
    en: 'No members match these conditions.',
  },
  downloadCsv: { de: 'CSV herunterladen', en: 'Download CSV' },
  downloadPdf: { de: 'PDF herunterladen', en: 'Download PDF' },
  copyNameList: { de: 'Namensliste kopieren', en: 'Copy name list' },
  nameListCopied: { de: 'Namensliste wurde kopiert.', en: 'Name list copied.' },
  exportError: { de: 'Der Export ist fehlgeschlagen.', en: 'Export failed.' },
  configureCheckIn: { de: 'Check-in konfigurieren', en: 'Configure check-in' },
  checkInResult: { de: 'Status nach dem Check-in', en: 'Status after check-in' },
  resetQrCode: { de: 'QR-Code zurücksetzen', en: 'Reset QR code' },
  resetQrCodeHint: {
    de: 'Der bisherige QR-Code wird sofort ungültig. Fortfahren?',
    en: 'The previous QR code will become invalid immediately. Continue?',
  },
  startCheckIn: { de: 'Starten', en: 'Start' },
  stopCheckIn: { de: 'Stoppen', en: 'Stop' },
  checkInActive: { de: 'Check-in ist aktiv', en: 'Check-in is active' },
  checkInStopped: { de: 'Check-in ist gestoppt', en: 'Check-in is stopped' },
  checkInLinkHint: {
    de: 'Scanne den Code, um das öffentliche Formular zu öffnen.',
    en: 'Scan the code to open the public form.',
  },
  copyCheckInLink: { de: 'Link kopieren', en: 'Copy link' },
  copyQrImage: { de: 'Bild kopieren', en: 'Copy image' },
  showFullscreen: { de: 'Vollbild anzeigen', en: 'Show fullscreen' },
  linkCopied: { de: 'Link wurde kopiert.', en: 'Link copied.' },
  imageCopied: { de: 'QR-Code wurde als PNG kopiert.', en: 'QR code copied as a PNG.' },
  clipboardError: {
    de: 'Kopieren wird von diesem Browser nicht unterstützt.',
    en: 'Copying is not supported by this browser.',
  },
  unrecognizedCheckIns: { de: 'Nicht erkannt', en: 'Not recognized' },
  successfulCheckIns: { de: 'Erfolgreich eingecheckt', en: 'Successfully checked in' },
  noUnrecognizedCheckIns: { de: 'Keine nicht erkannten Check-ins', en: 'No unrecognized check-ins' },
  noSuccessfulCheckIns: { de: 'Noch keine erfolgreichen Check-ins', en: 'No successful check-ins yet' },
  assignCheckIn: { de: 'Check-in zuordnen', en: 'Assign check-in' },
  assignCheckInHint: {
    de: 'Wähle das Mitglied aus, das mit diesem Check-in gemeint ist.',
    en: 'Choose the member this check-in belongs to.',
  },
  noMatchingMembers: { de: 'Versuche es mit einer neuen Suche', en: 'Try a new search' },
  suggestedMembers: { de: 'Ähnliche Mitglieder', en: 'Similar members' },
  similarity: { de: 'Ähnlichkeit', en: 'similarity' },
  assignmentError: {
    de: 'Der Check-in konnte nicht zugeordnet werden.',
    en: 'The check-in could not be assigned.',
  },
  submittedAt: { de: 'Zeitpunkt', en: 'Submitted at' },
  checkInFormTitle: { de: 'Bei Veranstaltung einchecken', en: 'Check in to event' },
  selectGroup: { de: 'Gruppe auswählen', en: 'Select group' },
  submitCheckIn: { de: 'Einchecken', en: 'Check in' },
  checkInSuccess: {
    de: 'Dein Check-in wurde erfolgreich übermittelt.',
    en: 'Your check-in was submitted successfully.',
  },
  checkInUnavailable: {
    de: 'Dieser Check-in ist momentan nicht geöffnet.',
    en: 'This check-in is not open right now.',
  },
  checkInInvalid: {
    de: 'Dieser QR-Code ist nicht mehr gültig.',
    en: 'This QR code is no longer valid.',
  },
  checkInSubmitError: {
    de: 'Der Check-in konnte nicht übermittelt werden. Bitte versuche es erneut.',
    en: 'The check-in could not be submitted. Please try again.',
  },
  noGroupsAvailable: {
    de: 'Für dieses Projekt sind keine Gruppen verfügbar.',
    en: 'No groups are available for this project.',
  },

  // Confirmations
  confirmDelete: {
    de: 'Wirklich endgültig löschen? Dies kann nicht rückgängig gemacht werden.',
    en: 'Permanently delete? This cannot be undone.',
  },
};

interface I18nContextValue {
  lang: Language;
  setLang: (l: Language) => void;
  t: (key: keyof typeof dict) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = 'anwesenheit.lang';

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [lang, setLangState] = useState<Language>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Language | null;
    return stored ?? DEFAULT_LANGUAGE;
  });

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang: (l: Language) => {
        setLangState(l);
        localStorage.setItem(STORAGE_KEY, l);
      },
      t: (key) => dict[key]?.[lang] ?? String(key),
    }),
    [lang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
};
